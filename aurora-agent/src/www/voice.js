// 음성 입력 (APK·브라우저·데스크톱 공통)
//  1) 직접 녹음(APK는 네이티브, 그 외는 getUserMedia) + Gemini 받아쓰기   2) APK 전용 폴백: 안드로이드 음성 인식 → 시스템 음성 입력 창
const Voice = (() => {
  /*NATIVE:BEGIN dev*/
  const dev = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AuroraDevice;
  /*NATIVE:END*/
  const STT_SYS = '당신은 한국어 음성 받아쓰기 도구입니다. 들린 말을 그대로 한 줄로 적습니다. 설명·따옴표·마침표 장식 없이 말한 내용만 적습니다. 소리가 없거나 알아들을 수 없으면 정확히 (없음) 이라고만 씁니다. 대부분 기기에 시키는 짧은 명령이나 질문입니다.';
  const cur = { onLevel() {}, onSpeech() {}, onPartial() {}, onStatus() {} };
  let wired = false;
  /*NATIVE:BEGIN wire*/
  function wire() {
    const D = dev(); if (!D || wired) return; wired = true;
    D.addListener('recLevel', (e) => cur.onLevel(Number(e.lvl)));
    D.addListener('recSpeech', () => cur.onSpeech());
    D.addListener('speechReady', () => cur.onStatus('🎤 말씀하세요', 'ready'));
    D.addListener('speechPartial', (e) => cur.onPartial(e.text));
    D.addListener('speechRms', (e) => cur.onLevel(Math.max(0, Math.min(1, (e.rms + 2) / 12))));
  }
  /*NATIVE:END*/
  const fail = (msg, code) => { const e = new Error(msg); e.code = code; return e; };

  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  function wavOf(f32, sr) {
    const buf = new ArrayBuffer(44 + f32.length * 2), v = new DataView(buf), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + f32.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, f32.length * 2, true);
    for (let i = 0; i < f32.length; i++) { const x = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Uint8Array(buf);
  }
  // 웹뷰/브라우저 마이크로 녹음: 말이 시작되면 잡고, 조용해지면 끝낸다
  async function recordJS({ maxMs = 14000, noSpeechMs = 7000, silenceMs = 750 } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const AC = window.AudioContext || window.webkitAudioContext; let ctx; try { ctx = new AC({ sampleRate: 16000 }); } catch { ctx = new AC(); }
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain(); mute.gain.value = 0;
    const chunks = []; const t0 = performance.now(); let speechStart = 0, lastLoud = 0, floor = 0.006, done = false, finish;
    const stop = () => { if (done) return; done = true; try { proc.disconnect(); src.disconnect(); mute.disconnect(); } catch {} stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); finish(); };
    proc.onaudioprocess = (e) => {
      if (done) return; const d = e.inputBuffer.getChannelData(0), now = performance.now(); chunks.push({ t: now, d: new Float32Array(d) });
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; const rms = Math.sqrt(s / d.length); cur.onLevel(Math.min(1, rms * 9));
      if (now - t0 < 250) { floor = Math.min(0.02, Math.max(floor, rms)); return; }
      if (rms > Math.max(0.018, floor * 2.6)) { if (!speechStart) { speechStart = now; cur.onSpeech(); } lastLoud = now; }
      if (speechStart && now - lastLoud > silenceMs && now - speechStart > 250) stop();
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
  /*NATIVE:BEGIN recordNative*/
  async function recordNative() {                                                         // APK: 네이티브 녹음 우선 (웹뷰 권한과 무관)
    const D = dev(); if (!(D && D.recordWav)) return { skip: true };
    try { return { wav: (await D.recordWav({ silenceMs: 750 })).wav }; } catch (e) { return { err: e && e.message ? e.message : String(e) }; }
  }
  /*NATIVE:END*/
  async function record() {
    const n = await recordNative(); if (n.wav !== undefined) return n.wav;
    try { return await recordJS(); }
    catch (e) { throw new Error((n.err ? '녹음: ' + n.err + ' / ' : '') + '마이크: ' + (e && e.name ? e.name + ' ' : '') + (e && e.message ? e.message : e)); }
  }
  async function geminiStt(wav, s) {
    let hint = ''; try { hint = (await window.PhoneAgent.vocab()).slice(0, 80).join(', '); } catch {}
    const r = await window.LLM.call({ provider: 'gemini', apiKey: s.apiKey, model: s.model, system: STT_SYS, maxTokens: 120,
      messages: [{ role: 'user', content: [{ type: 'text', text: '받아적어줘.' + (hint ? ' 자주 나오는 단어: ' + hint : '') }, { type: 'audio', source: { type: 'base64', media_type: 'audio/wav', data: wav } }] }] });
    const t = r.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim().replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '');
    return /^\(?\s*없음\s*\)?$/.test(t) ? '' : t;
  }
  /*NATIVE:BEGIN native*/
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
  /*NATIVE:END*/

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

  // ---- 한 번의 호출로 "받아쓰기 + 답변": 말이 끝나면 오디오를 보내 첫 줄은 들린 말, 이어서 답을 스트리밍으로 받는다 ----
  const TURN_SYS = `당신은 "오로라"라는 귀여운 AI입니다. 사용자는 음성으로 말했습니다.
출력 형식(그대로 지킴):
첫 줄: [말] 들린 말을 한국어로 그대로 받아쓴 것
둘째 줄부터:
- 기기 조작(앱 실행, 설정 켜고 끄기, 파일, 전화, 볼륨, 화면 등)을 시키는 말이면 정확히 [도구필요] 만 씁니다.
- 질문이나 대화면 [기분:happy|sad|angry|surprised|thinking|sleepy|love|laugh|neutral] 중 하나로 시작해 한두 문장으로 짧게 답합니다.
소리가 없거나 알아들을 수 없으면 첫 줄을 [말] (없음) 으로 하고 끝냅니다.`;
  // Gemini 한 번의 호출이 실패하면 기존 폴백(안드로이드 음성 인식 → 시스템 음성 입력 창)으로 이어진다
  // 웹사이트 버전: 기기 조작이 없으니 모든 말을 대화로 처리
  const SITE_TURN_SYS = `당신은 "오로라"라는 귀여운 AI입니다. 웹사이트에서 동작하며 사용자의 기기나 파일은 조작할 수 없습니다. 사용자는 음성으로 말했습니다.
출력 형식(그대로 지킴):
첫 줄: [말] 들린 말을 한국어로 그대로 받아쓴 것
둘째 줄부터: [기분:happy|sad|angry|surprised|thinking|sleepy|love|laugh|neutral] 중 하나로 시작해 한두 문장으로 짧게 답합니다. 기기 조작을 시키는 말이면 웹 버전에서는 할 수 없다고 짧게 알려 줍니다.
소리가 없거나 알아들을 수 없으면 첫 줄을 [말] (없음) 으로 하고 끝냅니다.`;
  async function listenAndAnswer(hooks = {}) {
    const s = await window.api.getSettings();
    if (!(s.provider === 'gemini' && s.apiKey)) { const v = await listen(hooks); return { text: v.text }; }       // Gemini가 아니면 기존 방식
    try { return await mergedTurn(hooks, s); }
    catch (e) {
      if (e && (e.code === 'silence' || e.code === 'mic')) throw e;
      const D = dev(), why = /^Gemini/.test(e && e.message) ? e.message : 'Gemini 받아쓰기 실패: ' + (e && e.message ? e.message : e);
      if (D) return nativeFallback(D, why);
      throw new Error(why);
    }
  }
  async function mergedTurn(hooks, s) {
    Object.assign(cur, { onLevel() {}, onSpeech() {}, onPartial() {}, onStatus() {} }, hooks); wire();
    const D = dev(); LLM.warm('gemini');                                                                           // 녹음하는 동안 연결을 미리 맺어 둔다
    if (D && !(await ensureMic(D))) throw fail('마이크 권한이 필요해요.', 'mic');
    cur.onStatus('🎤 말씀하세요', 'ready');
    let wav; try { wav = await record(); } catch (e) { throw new Error('Gemini 받아쓰기 실패: ' + (e && e.message ? e.message : e)); }
    if (!wav) throw fail('말소리가 들리지 않았어요.', 'silence');
    if (hooks.onRecorded) hooks.onRecorded();
    cur.onStatus('✍ 듣고 있어요…', 'transcribing');
    let hint = ''; try { hint = (await window.PhoneAgent.vocab()).slice(0, 40).join(', '); } catch {}
    const ctrl = new AbortController(); let transcript = '', told = false, aborted = false, lastAns = '';
    const parse = (txt) => { const m = txt.match(/^\s*\[말\]\s*([^\n]*)(\n([\s\S]*))?$/); return m ? { t: m[1].trim(), done: m[2] !== undefined, rest: m[3] || '' } : null; };
    let rs;
    try {
      rs = await LLM.fastStream({ provider: 'gemini', apiKey: s.apiKey, model: s.model, fastModel: s.fastModel, system: window.AURORA_SITE ? SITE_TURN_SYS : TURN_SYS, maxTokens: 360, signal: ctrl.signal,
        messages: [{ role: 'user', content: [{ type: 'text', text: '듣고 처리해줘.' + (hint ? ' 자주 나오는 단어: ' + hint : '') }, { type: 'audio', source: { type: 'base64', media_type: 'audio/wav', data: wav } }] }],
        onDelta: (txt) => {
          const p = parse(txt); if (!p || !p.done) return;
          if (!told) {                                                                                       // 첫 줄(들린 말)이 완성되는 순간
            told = true; transcript = p.t; if (!transcript || /^\(?\s*없음\s*\)?$/.test(transcript)) { aborted = true; ctrl.abort(); return; }
            if (hooks.onTranscript) hooks.onTranscript(transcript);
            const pa = window.PhoneAgent; const cmd = !window.AURORA_SITE && LLM.TOOLISH.test(transcript);
            if (cmd) { aborted = true; ctrl.abort(); return; }                                              // 기기 조작 말이면 답 생성 중단 → 명령 경로로
            if (pa && pa.matchScore) pa.matchScore(transcript).then((sc) => { if (sc >= 2 && !aborted) { aborted = true; ctrl.abort(); } }).catch(() => {});
          }
          const c = LLM.moodSplit(p.rest); if (c.ready && c.text && c.text !== lastAns && !/^\s*\[도구필요/.test(p.rest)) { lastAns = c.text; if (hooks.onDelta) hooks.onDelta(c.text); }
        } });
    } catch (e) {
      if (!(aborted && e && e.name === 'AbortError')) throw new Error('Gemini 받아쓰기 실패: ' + (e && e.message ? e.message : e));
    }
    if (aborted && !transcript) throw fail('말소리가 들리지 않았어요.', 'silence');
    if (aborted) return { text: transcript };                                                                  // 명령: 호출자가 즉시 실행 경로로 처리
    const raw = (rs && rs.content[0] && rs.content[0].text || ''); const p = parse(raw);
    if (!p) {                                                                                                 // 모델이 형식을 안 지켰으면 전체를 받아쓴 말로 취급
      const t = raw.trim().replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '');
      if (!t || /^\(?\s*없음\s*\)?$/.test(t)) throw fail('말소리가 들리지 않았어요.', 'silence');
      if (hooks.onTranscript && !told) hooks.onTranscript(t); return { text: t };
    }
    if (!p.t || /^\(?\s*없음\s*\)?$/.test(p.t)) throw fail('말소리가 들리지 않았어요.', 'silence');
    if (!told && hooks.onTranscript) hooks.onTranscript(p.t);
    if (!p.rest.trim() || /^\s*\[도구필요/.test(p.rest)) return { text: p.t, needTools: true };
    const c = LLM.moodSplit(p.rest.trim()); return { text: p.t, reply: { text: c.text.trim() || p.rest.trim(), mood: c.mood } };
  }

  return { listen, listenAndAnswer, available: () => true };
})();
