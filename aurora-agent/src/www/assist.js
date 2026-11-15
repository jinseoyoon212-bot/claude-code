// 어시스턴트 오버레이: 말하기(음성 인식) + 써클 투 서치(화면을 동그라미로 선택해 AI에게 물어보기)
(async () => {
  const D = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AuroraDevice;
  if (!D || !D.isAssistMode) return;
  let st; try { st = await D.isAssistMode(); } catch { return; }
  if (!st.assist) return;

  const root = document.documentElement; root.classList.add('assist');
  const ubub = document.getElementById('ubub'), bubble = document.getElementById('bubble'), face = document.getElementById('face'), input = document.getElementById('input'), form = document.getElementById('form');
  const shownAt = Date.now();
  let busy = false, idle, shotImg = null;
  const setState = (s) => { ['listening', 'thinking', 'speaking'].forEach((c) => root.classList.toggle(c, c === s)); };
  const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => D.closeAssist(), 40000); };
  const say = async (t) => { try { await D.speak({ text: t }); } catch {} };
  const talk = async (t) => { setState('speaking'); Face.setTalking(true); await say(t); Face.setTalking(false); setState(null); };

  // ---- 화면 구성: 고정 캡처 + 빛 테두리 + 그리기 캔버스 ----
  const aura = document.createElement('div'); aura.id = 'aura';
  aura.innerHTML = '<div class="ring glow"><i></i></div><div class="ring crisp"><i></i></div><div class="wash"></div>';
  const hint = document.createElement('div'); hint.id = 'hint';
  const acts = document.createElement('div'); acts.id = 'acts'; (face.parentElement || face).after(acts);
  const cv = document.createElement('canvas'); cv.id = 'circle';
  document.body.prepend(cv); document.body.prepend(aura); document.body.append(hint);
  requestAnimationFrame(() => requestAnimationFrame(() => { try { D.assistReady(); } catch {} }));   // 흰 화면 방지: 그릴 준비가 되면 보여준다

  // 호출 순간의 화면 캡처 가져오기 (시스템 스크린샷은 조금 늦게 올 수 있어 잠깐 기다림)
  (async () => {
    for (let i = 0; i < 10 && !shotImg; i++) {
      try {
        const r = await D.getAssistScreenshot({ maxPx: 1800, quality: 0.85 });
        if (r && r.image) {
          const img = new Image(); img.id = 'shot'; img.src = 'data:image/jpeg;base64,' + r.image;
          await img.decode().catch(() => {}); shotImg = img; document.body.prepend(img);
          hint.textContent = '✨ 검색할 곳을 동그라미로 그려 보세요'; setTimeout(() => hint.classList.add('off'), 7000); return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    hint.style.display = 'none';
  })();

  // ---- 동그라미 그리기 ----
  const g = cv.getContext('2d'); let pts = [], drawing = false, fade = null;
  // 캔버스의 '화면에 보이는 크기'를 뷰포트에 딱 맞춘다 (픽셀 수만 배율만큼 늘림). 안 맞추면 그림이 배율만큼 커져 오른쪽/아래로 밀린다
  const fit = () => { const d = window.devicePixelRatio || 1; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px'; cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d); g.setTransform(d, 0, 0, d, 0, 0); };
  const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  fit(); addEventListener('resize', fit);
  const chaikin = (P) => { for (let k = 0; k < 2 && P.length > 2; k++) { const Q = [P[0]]; for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; Q.push({ x: .75 * a.x + .25 * b.x, y: .75 * a.y + .25 * b.y }, { x: .25 * a.x + .75 * b.x, y: .25 * a.y + .75 * b.y }); } Q.push(P[P.length - 1]); P = Q; } return P; };
  const stroke = () => {
    g.clearRect(0, 0, innerWidth, innerHeight); if (pts.length < 2) return;
    const sp = chaikin(pts);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [w, blur, a] of [[16, 26, .45], [7, 10, .9], [3.5, 0, 1]]) {
      for (let i = 1; i < sp.length; i++) {
        g.beginPath(); g.moveTo(sp[i - 1].x, sp[i - 1].y); g.lineTo(sp[i].x, sp[i].y);
        g.strokeStyle = `hsla(${(i * 1.2 + 300) % 360},95%,${blur ? 72 : 88}%,${a})`; g.shadowColor = `hsla(${(i * 1.2 + 300) % 360},100%,75%,.9)`; g.shadowBlur = blur; g.lineWidth = w; g.stroke();
      }
    }
    g.shadowBlur = 0;
  };
  const clearStroke = () => { pts = []; g.clearRect(0, 0, innerWidth, innerHeight); };
  cv.addEventListener('pointerdown', (e) => { if (busy) return; drawing = true; pts = [at(e)]; cv.setPointerCapture(e.pointerId); hint.classList.add('off'); try { D.stopSpeak(); } catch {} });
  cv.addEventListener('pointermove', (e) => { if (!drawing) return; pts.push(at(e)); stroke(); });
  cv.addEventListener('pointerup', () => {
    if (!drawing) return; drawing = false;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const box = { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
    if (pts.length < 6 || box.r - box.l < 40 || box.b - box.t < 40) { clearStroke(); if (Date.now() - shownAt > 800) D.closeAssist(); return; }   // 짧게 톡 → 닫기
    searchRegion(box);
  });

  // ---- 써클 투 서치: 선택 영역을 잘라 이미지를 이해하는 AI에게 물어본다 ----
  const SYS = `사용자가 휴대폰 화면의 일부를 동그라미로 골라 "이게 뭐야?"라고 물었습니다. 이미지는 그 영역을 잘라낸 것입니다.
규칙: 한국어로 답합니다. 첫 줄은 정확히 [검색어:구글에서 이걸 찾기에 가장 좋은 검색어 하나] 형식으로 씁니다. 그 다음 줄부터 2~3문장으로 설명합니다.
- 상품이면 이름·종류·특징, 글자면 번역·요약, 장소·인물·동식물·음식이면 무엇인지, 에러/UI면 무슨 뜻인지 알려줍니다.
- 확실하지 않으면 추측임을 밝히고, 보이는 단서를 말해 줍니다.`;

  async function searchRegion(box) {
    if (!shotImg) { clearStroke(); bubble.textContent = '화면 캡처가 없어서 써클 투 서치를 못 써요. ⚙ 설정에서 Shizuku를 켜거나, 어시스턴트 설정의 "스크린샷 사용"을 켜세요.'; return; }
    busy = true; resetIdle(); setState('thinking'); Face.setMood('thinking'); Face.doMotion('tilt'); bubble.textContent = '🔍 살펴보는 중…'; acts.style.display = 'none';
    try {
      const kx = shotImg.naturalWidth / innerWidth, ky = shotImg.naturalHeight / innerHeight, pad = Math.max(16, 0.1 * Math.max(box.r - box.l, box.b - box.t));
      const sx = Math.max(0, (box.l - pad) * kx), sy = Math.max(0, (box.t - pad) * ky);
      const sw = Math.min(shotImg.naturalWidth - sx, (box.r - box.l + pad * 2) * kx), sh = Math.min(shotImg.naturalHeight - sy, (box.b - box.t + pad * 2) * ky);
      const sc = Math.min(1, 1024 / Math.max(sw, sh)), oc = document.createElement('canvas'); oc.width = Math.round(sw * sc); oc.height = Math.round(sh * sc);
      oc.getContext('2d').drawImage(shotImg, sx, sy, sw, sh, 0, 0, oc.width, oc.height);
      const data = oc.toDataURL('image/jpeg', 0.88).split(',')[1];
      const s = await window.api.getSettings();
      if (s.provider === 'pollinations') throw new Error('이미지를 이해하는 AI가 필요해요. ⚙ 설정에서 제공자를 Google Gemini(무료)로 바꾸고 키를 넣어 주세요.');
      if (!s.apiKey) throw new Error('API 키가 없어요. ⚙ 설정에서 키를 넣어 주세요.');
      const r = await window.LLM.call({ provider: s.provider, apiKey: s.apiKey, model: s.model, system: SYS, maxTokens: 700,
        messages: [{ role: 'user', content: [{ type: 'text', text: '동그라미 친 부분이 뭐야?' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }] }] });
      let text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      let q = ''; const m = text.match(/^\s*\[검색어:([^\]]+)\]\s*/); if (m) { q = m[1].trim(); text = text.slice(m[0].length); }
      busy = false; Face.setMood('happy'); Face.doMotion('wave'); bubble.textContent = text; setState(null);
      acts.innerHTML = ''; acts.style.display = 'flex';
      const mk = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = (e) => { e.stopPropagation(); fn(); }; acts.appendChild(b); };
      if (q) mk('🔍 구글에서 검색', '', async () => { await D.openIntent({ uri: 'https://www.google.com/search?q=' + encodeURIComponent(q) }); D.closeAssist(); });
      mk('다시 그리기', 'sub', () => { acts.style.display = 'none'; clearStroke(); bubble.textContent = '검색할 곳을 다시 그려 보세요'; try { D.stopSpeak(); } catch {} });
      resetIdle(); await talk(text.replace(/[`*#_>]/g, '').slice(0, 220));
    } catch (e) {
      busy = false; setState(null); Face.setMood('sad'); Face.doMotion('droop'); bubble.textContent = '⚠ ' + (e && e.message ? e.message : e); resetIdle();
    }
  }

  // ---- 음성: 얼굴을 터치하면 듣기 ----
  D.addListener('speechReady', () => { if (busy) { bubble.textContent = '🎤 말씀하세요'; Face.setMood('surprised'); } });
  D.addListener('speechPartial', (e) => { if (busy && window.showUser) window.showUser(e.text, true); });
  let lastRms = 0; D.addListener('speechRms', (e) => { const now = Date.now(); if (now - lastRms < 60) return; lastRms = now; root.style.setProperty('--lvl', Math.max(0, Math.min(1, (e.rms + 2) / 12)).toFixed(2)); });


  // ---- 직접 녹음 + Gemini 받아쓰기: 안드로이드 음성 인식 서비스(구글 앱)에 의존하지 않는다 ----
  const STT_SYS = '당신은 한국어 음성 받아쓰기 도구입니다. 들린 말을 그대로 한 줄로 적습니다. 설명·따옴표·마침표 장식 없이 말한 내용만 적습니다. 소리가 없거나 알아들을 수 없으면 정확히 (없음) 이라고만 씁니다. 대부분 폰에 시키는 짧은 명령입니다(예: 와이파이 꺼줘, 네이버 열어줘, 볼륨 올려).';
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  function wavOf(f32, sr) {
    const buf = new ArrayBuffer(44 + f32.length * 2), v = new DataView(buf), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + f32.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, f32.length * 2, true);
    for (let i = 0; i < f32.length; i++) { const x = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Uint8Array(buf);
  }
  async function recordWav({ maxMs = 14000, noSpeechMs = 7000, silenceMs = 1300, onLevel, onSpeech }) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const AC = window.AudioContext || window.webkitAudioContext; let ctx; try { ctx = new AC({ sampleRate: 16000 }); } catch { ctx = new AC(); }
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain(); mute.gain.value = 0;
    const chunks = []; const t0 = performance.now(); let speechStart = 0, lastLoud = 0, floor = 0.006, done = false, finish;
    const stop = () => { if (done) return; done = true; try { proc.disconnect(); src.disconnect(); mute.disconnect(); } catch {} stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); finish(); };
    proc.onaudioprocess = (e) => {
      if (done) return; const d = e.inputBuffer.getChannelData(0); const now = performance.now(); chunks.push({ t: now, d: new Float32Array(d) });
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; const rms = Math.sqrt(s / d.length); if (onLevel) onLevel(Math.min(1, rms * 9));
      if (now - t0 < 400) { floor = Math.max(floor, rms); return; }                       // 처음 0.4초로 배경 소음 크기를 잰다
      if (rms > Math.max(0.018, floor * 2.6)) { if (!speechStart) { speechStart = now; if (onSpeech) onSpeech(); } lastLoud = now; }
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
  D.addListener('recLevel', (e) => { if (busy) root.style.setProperty('--lvl', Number(e.lvl).toFixed(2)); });
  D.addListener('recSpeech', () => { if (busy) bubble.textContent = '🎤 듣고 있어요…'; });
  async function geminiListen(s) {
    bubble.textContent = '🎤 말씀하세요';
    let wav = null, nerr = '';
    if (D.recordWav) { try { wav = (await D.recordWav({})).wav; } catch (e) { nerr = e && e.message ? e.message : String(e); wav = null; } }   // 1순위: 네이티브 녹음 (웹뷰 권한과 무관)
    if (wav === null) {                                                                                                                              // 2순위: 웹뷰 마이크
      try { wav = await recordWav({ onLevel: (v) => root.style.setProperty('--lvl', v.toFixed(2)), onSpeech: () => { bubble.textContent = '🎤 듣고 있어요…'; } }); }
      catch (e) { throw new Error((nerr ? '녹음: ' + nerr + ' / ' : '') + '웹뷰 마이크: ' + (e && e.name ? e.name + ' ' : '') + (e && e.message ? e.message : e)); }
    }
    root.style.setProperty('--lvl', 0); if (!wav) return '';
    setState('thinking'); bubble.textContent = '✍ 받아쓰는 중…';
    let hint = ''; try { hint = (await window.PhoneAgent.vocab()).slice(0, 80).join(', '); } catch {}
    const r = await window.LLM.call({ provider: 'gemini', apiKey: s.apiKey, model: s.model, system: STT_SYS, maxTokens: 120,
      messages: [{ role: 'user', content: [{ type: 'text', text: '받아적어줘.' + (hint ? ' 자주 나오는 단어: ' + hint : '') }, { type: 'audio', source: { type: 'base64', media_type: 'audio/wav', data: wav } }] }] });
    const t = r.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim().replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '');
    return /^\(?\s*없음\s*\)?$/.test(t) ? '' : t;
  }

  // ---- 마이크 권한 확보: ① 이미 있음 ② Shizuku로 즉시 허용 ③ 권한 창(12초) ④ 안 되면 설정 화면 안내 ----
  async function ensureMic() {
    try { if ((await D.micStatus()).granted) return true; } catch {}
    try { if (D.shizukuStatus && (await D.shizukuStatus()).granted) { await D.shizukuShell({ command: 'pm grant com.aurora.agent android.permission.RECORD_AUDIO' }); if ((await D.micStatus()).granted) return true; } } catch {}
    try { const r = await Promise.race([D.requestMic(), new Promise((res) => setTimeout(() => res({ granted: false }), 12000))]); if (r && r.granted) return true; } catch {}
    return false;
  }
  function micDenied() {
    busy = false; setState(null); Face.setMood('sad'); Face.doMotion('droop');
    bubble.textContent = '마이크 권한이 필요해요. 설정 → 권한 → 마이크 → 허용으로 바꿔 주세요.';
    acts.innerHTML = ''; acts.style.display = 'flex';
    const b = document.createElement('button'); b.textContent = '⚙ 권한 설정 열기'; b.onclick = async (e) => { e.stopPropagation(); await D.openAppInfo(); D.closeAssist(); }; acts.appendChild(b); resetIdle();
  }

  async function listen() {
    if (busy) return; busy = true; resetIdle(); clearStroke(); acts.style.display = 'none';
    try { D.stopSpeak(); } catch {}
    setState('listening'); Face.setMood('surprised'); Face.doMotion('jump'); bubble.textContent = '🎤 준비 중…';
    if (!(await ensureMic())) { micDenied(); return; }
    let why = '';
    try {
      let best = '';
      const s = await window.api.getSettings();
      // 1순위: 직접 녹음 + Gemini 받아쓰기 (구글 음성 서비스 오류와 무관, 정확도 높음)
      if (s.provider === 'gemini' && s.apiKey && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try { best = await geminiListen(s); if (!best) { busy = false; setState(null); Face.setMood('sad'); bubble.textContent = '말소리가 들리지 않았어요. 얼굴을 눌러 다시 말해 주세요.'; resetIdle(); return; } }
        catch (e) { why = 'Gemini 받아쓰기 실패: ' + (e && e.message ? e.message : e); best = ''; }
      }
      // 2순위: 안드로이드 음성 인식 → 3순위: 시스템 음성 입력 창
      if (!best) {
        setState('listening'); bubble.textContent = '🎤 준비 중…';
        let bias = []; try { bias = await window.PhoneAgent.vocab(); } catch {}
        let r;
        try { r = await D.listen({ biasing: bias }); }
        catch (e) {
          const msg = e && e.message ? e.message : '';
          if (/코드 (3|4|5|8|11|12|13|14)\b|시작하지 못/.test(msg) && D.listenDialog) { bubble.textContent = '🎤 시스템 음성 입력 창으로 시도해요…'; try { r = await D.listenDialog(); } catch (e2) { throw new Error(msg + (why ? ' / ' + why : '')); } }
          else throw e;
        }
        // 후보 중 우리가 아는 명령/앱 이름과 가장 잘 맞는 문장을 고른다 (없으면 1순위)
        let bs = -1; const texts = r.texts && r.texts.length ? r.texts : [r.text]; best = r.text;
        for (let i = 0; i < texts.length; i++) { let sc = 0; try { sc = await window.PhoneAgent.matchScore(texts[i]); } catch {} sc += (r.scores && r.scores[i] || 0) * 0.5 - i * 0.05; if (sc > bs) { bs = sc; best = texts[i]; } }
      }
      root.style.setProperty('--lvl', 0); setState('thinking');
      bubble.textContent = best; input.value = best; form.requestSubmit();     // 이후는 기존 대화/명령 로직(renderer.js)이 처리
    } catch (e) {
      busy = false; setState(null); root.style.setProperty('--lvl', 0); Face.setMood('sad'); Face.doMotion('droop');
      bubble.textContent = (e && e.message ? e.message : '잘 못 들었어요.') + (why && !String(e && e.message).includes(why) ? ' / ' + why : '') + ' 얼굴을 눌러 다시 말해 주세요.'; resetIdle();
    }
  }
  face.addEventListener('click', (e) => { e.stopPropagation(); listen(); });

  window.AuroraAssist = {
    onAnswer: async (r) => {
      busy = false; resetIdle(); setState(null);
      const spoken = String(r.text || '').replace(/[`*#_>]/g, '').slice(0, 300);
      if (r.stay) { say(spoken); setTimeout(() => D.closeAssist(), 500); return; }   // 앱을 열었으면 오버레이를 닫아 앱이 보이게
      await talk(spoken); resetIdle();
    },
  };

  bubble.textContent = '무엇을 도와드릴까요?'; Face.setMood('happy'); Face.doMotion('wave');
  await talk('무엇을 도와드릴까요?'); resetIdle();
})();
