// 음성 입력 (APK·브라우저·데스크톱 공통)
//  1) 직접 녹음(APK는 네이티브, 그 외는 getUserMedia) + Gemini 받아쓰기   2) APK 전용 폴백: 안드로이드 음성 인식 → 시스템 음성 입력 창
const Voice = (() => {
  const dev = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AuroraDevice;
  const STT_SYS = '당신은 한국어 음성 받아쓰기 도구입니다. 들린 말을 그대로 한 줄로 적습니다. 설명·따옴표·마침표 장식 없이 말한 내용만 적습니다. 소리가 없거나 알아들을 수 없으면 정확히 (없음) 이라고만 씁니다. 대부분 기기에 시키는 짧은 명령이나 질문입니다.';
  const cur = { onLevel() {}, onSpeech() {}, onPartial() {}, onStatus() {} };
  let wired = false;
  function wire() {
    const D = dev(); if (!D || wired) return; wired = true;
    D.addListener('recLevel', (e) => cur.onLevel(Number(e.lvl)));
    D.addListener('recSpeech', () => cur.onSpeech());
    D.addListener('speechReady', () => cur.onStatus('🎤 말씀하세요', 'ready'));
    D.addListener('speechPartial', (e) => cur.onPartial(e.text));
    D.addListener('speechRms', (e) => cur.onLevel(Math.max(0, Math.min(1, (e.rms + 2) / 12))));
  }
  const fail = (msg, code) => { const e = new Error(msg); e.code = code; return e; };

  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  function wavOf(f32, sr) {
    const buf = new ArrayBuffer(44 + f32.length * 2), v = new DataView(buf), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + f32.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, f32.length * 2, true);
    for (let i = 0; i < f32.length; i++) { const x = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Uint8Array(buf);
  }
  // 웹뷰/브라우저 마이크로 녹음: 말이 시작되면 잡고, 조용해지면 끝낸다
  async function recordJS({ maxMs = 14000, noSpeechMs = 7000, silenceMs = 1300 } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const AC = window.AudioContext || window.webkitAudioContext; let ctx; try { ctx = new AC({ sampleRate: 16000 }); } catch { ctx = new AC(); }
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain(); mute.gain.value = 0;
    const chunks = []; const t0 = performance.now(); let speechStart = 0, lastLoud = 0, floor = 0.006, done = false, finish;
    const stop = () => { if (done) return; done = true; try { proc.disconnect(); src.disconnect(); mute.disconnect(); } catch {} stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); finish(); };
    proc.onaudioprocess = (e) => {
      if (done) return; const d = e.inputBuffer.getChannelData(0), now = performance.now(); chunks.push({ t: now, d: new Float32Array(d) });
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; const rms = Math.sqrt(s / d.length); cur.onLevel(Math.min(1, rms * 9));
      if (now - t0 < 400) { floor = Math.max(floor, rms); return; }
      if (rms > Math.max(0.018, floor * 2.6)) { if (!speechStart) { speechStart = now; cur.onSpeech(); } lastLoud = now; }
      if (speechStart && now - lastLoud > silenceMs && now - speechStart > 350) stop();
      else if (!speechStart && now - t0 > noSpeechMs) stop();
      else if (now - t0 > maxMs) stop();
    };
    src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    await new Promise((r) => { finish = r; });
    if (!speechStart) return '';
    const keep = chunks.filter((c) => c.t >= speechStart - 350).map((c) => c.d); let n = 0; keep.forEach((c) => (n += c.length));
    let pcm = new Float32Array(n), o = 0; keep.forEach((c) => { pcm.set(c, o); o += c.length; });
    const sr = ctx.sampleRate;
    if (sr !== 16000) { const r = sr / 16000, m = Math.floor(pcm.length / r), out = new Float32Array(m); for (let i = 0; i < m; i++) { const p = i * r, i0 = Math.floor(p), f = p - i0; out[i] = pcm[i0] * (1 - f) + (pcm[i0 + 1] || pcm[i0]) * f; } pcm = out; }
    return b64(wavOf(pcm, 16000));
  }
  async function record() {
    const D = dev(); let nerr = '';
    if (D && D.recordWav) { try { return (await D.recordWav({})).wav; } catch (e) { nerr = e && e.message ? e.message : String(e); } }   // APK: 네이티브 녹음 우선 (웹뷰 권한과 무관)
    try { return await recordJS(); }
    catch (e) { throw new Error((nerr ? '녹음: ' + nerr + ' / ' : '') + '마이크: ' + (e && e.name ? e.name + ' ' : '') + (e && e.message ? e.message : e)); }
  }
  async function geminiStt(wav, s) {
    let hint = ''; try { hint = (await window.PhoneAgent.vocab()).slice(0, 80).join(', '); } catch {}
    const r = await window.LLM.call({ provider: 'gemini', apiKey: s.apiKey, model: s.model, system: STT_SYS, maxTokens: 120,
      messages: [{ role: 'user', content: [{ type: 'text', text: '받아적어줘.' + (hint ? ' 자주 나오는 단어: ' + hint : '') }, { type: 'audio', source: { type: 'base64', media_type: 'audio/wav', data: wav } }] }] });
    const t = r.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim().replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '');
    return /^\(?\s*없음\s*\)?$/.test(t) ? '' : t;
  }
  // 마이크 권한(APK): ① 이미 있음 ② Shizuku로 즉시 허용 ③ 권한 창(12초) → 안 되면 false
  async function ensureMic(D) {
    try { if ((await D.micStatus()).granted) return true; } catch {}
    try { if (D.shizukuStatus && (await D.shizukuStatus()).granted) { await D.shizukuShell({ command: 'pm grant com.aurora.agent android.permission.RECORD_AUDIO' }); if ((await D.micStatus()).granted) return true; } } catch {}
    try { const r = await Promise.race([D.requestMic(), new Promise((res) => setTimeout(() => res({ granted: false }), 12000))]); if (r && r.granted) return true; } catch {}
    return false;
  }
  async function nativeFallback(D, why) {
    cur.onStatus('🎤 준비 중…', 'ready');
    let bias = []; try { bias = await window.PhoneAgent.vocab(); } catch {}
    let r;
    try { r = await D.listen({ biasing: bias }); }
    catch (e) {
      const msg = e && e.message ? e.message : '';
      if (/코드 (3|4|5|8|11|12|13|14)\b|시작하지 못/.test(msg) && D.listenDialog) { cur.onStatus('🎤 시스템 음성 입력 창으로 시도해요…', 'ready'); try { r = await D.listenDialog(); } catch { throw new Error(msg + (why ? ' / ' + why : '')); } }
      else throw new Error(msg + (why && !msg.includes(why) ? ' / ' + why : ''));
    }
    let best = r.text, bs = -1; const texts = r.texts && r.texts.length ? r.texts : [r.text];   // 후보 중 아는 명령/앱 이름과 가장 잘 맞는 문장
    for (let i = 0; i < texts.length; i++) { let sc = 0; try { sc = await window.PhoneAgent.matchScore(texts[i]); } catch {} sc += (r.scores && r.scores[i] || 0) * 0.5 - i * 0.05; if (sc > bs) { bs = sc; best = texts[i]; } }
    return { text: best, via: 'android' };
  }

  /** hooks: onStatus(text, phase), onLevel(0..1), onSpeech(), onPartial(text) → { text, via } 또는 오류(code: 'mic' | 'silence') */
  async function listen(hooks = {}) {
    Object.assign(cur, { onLevel() {}, onSpeech() {}, onPartial() {}, onStatus() {} }, hooks); wire();
    const D = dev(), s = await window.api.getSettings(), gemini = s.provider === 'gemini' && s.apiKey; let why = '';
    if (D && !(await ensureMic(D))) throw fail('마이크 권한이 필요해요.', 'mic');
    if (gemini) {
      try {
        cur.onStatus('🎤 말씀하세요', 'ready');
        const wav = await record(); if (!wav) throw fail('말소리가 들리지 않았어요.', 'silence');
        cur.onStatus('✍ 받아쓰는 중…', 'transcribing');
        const t = await geminiStt(wav, s); if (!t) throw fail('말소리가 들리지 않았어요.', 'silence');
        return { text: t, via: 'gemini' };
      } catch (e) { if (e.code === 'silence') throw e; why = 'Gemini 받아쓰기 실패: ' + (e && e.message ? e.message : e); }
    }
    if (D) return nativeFallback(D, why);
    throw new Error(why || '음성 입력은 Gemini 키가 있을 때 쓸 수 있어요. ⚙ 설정에서 제공자를 Google Gemini(무료)로 바꾸고 키를 넣어 주세요.');
  }
  return { listen, available: () => true };
})();
