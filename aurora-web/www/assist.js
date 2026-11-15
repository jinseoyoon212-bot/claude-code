// 어시스턴트 오버레이 (홈 길게 누르기): 애플 인텔리전스 빛 테두리 + 음성(얼굴 터치) + 써클 투 서치
(async () => {
  const D = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AuroraDevice;
  if (!D || !D.isAssistMode) return;
  let st; try { st = await D.isAssistMode(); } catch { return; }
  if (!st.assist) return;

  const root = document.documentElement; root.classList.add('assist');
  const $ = (id) => document.getElementById(id);
  const ubub = $('ubub'), bubble = $('bubble'), face = $('face');
  const shownAt = Date.now();
  let busy = false, idle, shotImg = null, selAnim = null, hasSel = false;
  const setState = (s) => { ['listening', 'thinking', 'speaking'].forEach((c) => root.classList.toggle(c, c === s)); };
  const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => D.closeAssist(), 45000); };
  const say = async (t) => { try { await D.speak({ text: t }); } catch {} };
  const talk = async (t) => { setState('speaking'); Face.setTalking(true); await say(t); Face.setTalking(false); setState(null); };
  const say2 = (t) => { window.setBubble ? window.setBubble(t) : (bubble.textContent = t); };

  // ---- 화면 구성: 고정 캡처 / 선택 영역 / 빛 테두리 / 그리기 캔버스 ----
  const aura = document.createElement('div'); aura.id = 'aura';
  aura.innerHTML = '<div class="ai l1"><i></i></div><div class="ai l2"><i></i></div><div class="ai l3"><i></i></div><div class="haze"></div>';
  const sel = document.createElement('div'); sel.id = 'sel';
  const hint = document.createElement('div'); hint.id = 'hint';
  const acts = document.createElement('div'); acts.id = 'acts'; (face.parentElement || face).after(acts);
  const cv = document.createElement('canvas'); cv.id = 'circle';
  document.body.prepend(cv); document.body.prepend(aura); document.body.prepend(sel); document.body.append(hint);
  requestAnimationFrame(() => requestAnimationFrame(() => { try { D.assistReady(); } catch {} }));   // 그릴 준비가 끝나면 보여준다 (흰 화면 방지)

  // 호출 순간의 화면 캡처 (시스템 스크린샷은 조금 늦게 올 수 있어 잠깐 기다림)
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

  // ================= 동그라미 그리기: 부드러운 곡선 + 흐르는 애플 인텔리전스 색 =================
  const PAL = [[188, 130, 243], [245, 185, 234], [141, 159, 255], [255, 103, 120], [255, 186, 113], [198, 134, 255]];
  const palAt = (u) => { u = ((u % 1) + 1) % 1; const x = u * PAL.length, i = Math.floor(x), f = x - i, a = PAL[i % PAL.length], b = PAL[(i + 1) % PAL.length]; return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`; };
  const g = cv.getContext('2d'); let raw = [], dense = [], drawing = false, rafId = 0, closing = null; const t0 = performance.now();
  const fit = () => { const d = window.devicePixelRatio || 1; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px'; cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d); g.setTransform(d, 0, 0, d, 0, 0); };
  fit(); addEventListener('resize', fit);
  const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function smooth(P) {   // Catmull-Rom 스플라인으로 촘촘하고 매끈한 곡선
    if (P.length < 3) return P.slice(); const out = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      const n = Math.max(2, Math.min(12, Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2.5)));
      for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t;
        out.push({ x: .5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
                   y: .5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3) }); }
    }
    out.push(P[P.length - 1]); return out;
  }
  function frame(now) {
    rafId = 0; g.clearRect(0, 0, innerWidth, innerHeight);
    if (closing) {                                                                    // 손을 떼면 시작점으로 부드럽게 이어져 닫힌 고리가 된다
      const p = Math.min(1, (now - closing.t) / 300), e = 1 - Math.pow(1 - p, 3), a = raw[raw.length - 1], b = raw[0];
      dense = smooth(raw.concat([{ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }]));
      if (p >= 1) { const box = closing.box; closing = null; dense = smooth(raw.concat([raw[0]])); paint(now); selectBox(box); return; }
    }
    paint(now); if (drawing || closing) rafId = requestAnimationFrame(frame);
  }
  function paint(now) {
    const n = dense.length; if (n < 2) return; const off = (now - t0) / 1700; g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 1; i < n; i++) { const u = i / n, taper = Math.min(1, i / 16); g.strokeStyle = palAt(u * 1.25 + off); g.lineWidth = 2.6 + 3.6 * taper; g.beginPath(); g.moveTo(dense[i - 1].x, dense[i - 1].y); g.lineTo(dense[i].x, dense[i].y); g.stroke(); }
  }
  const kick = () => { if (!rafId) rafId = requestAnimationFrame(frame); };
  const clearStroke = () => { raw = []; dense = []; closing = null; g.clearRect(0, 0, innerWidth, innerHeight); };

  cv.addEventListener('pointerdown', (e) => {
    if (busy || (window.isBusy && window.isBusy())) return;
    hideSel(); acts.style.display = 'none'; clearStroke(); drawing = true; raw = [at(e)]; cv.setPointerCapture(e.pointerId); hint.classList.add('off'); try { D.stopSpeak(); } catch {}
    cv.classList.remove('gone'); kick();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) { const p = at(ev), l = raw[raw.length - 1]; if (!l || Math.hypot(p.x - l.x, p.y - l.y) > 1.2) raw.push(p); }
    dense = smooth(raw); kick();
  });
  cv.addEventListener('pointerup', () => {
    if (!drawing) return; drawing = false;
    const xs = raw.map((p) => p.x), ys = raw.map((p) => p.y), box = { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
    if (raw.length < 6 || box.r - box.l < 40 || box.b - box.t < 40) { clearStroke(); if (Date.now() - shownAt > 800) D.closeAssist(); return; }   // 짧게 톡 → 닫기
    closing = { t: performance.now(), box }; kick();
  });
  cv.addEventListener('pointercancel', () => { drawing = false; clearStroke(); });

  // ================= 선택 영역: 윤곽선이 스프링으로 자리잡고 바깥은 부드럽게 어두워짐 =================
  function selectBox(box) {
    if (!shotImg) { clearStroke(); say2('화면 캡처가 없어서 써클 투 서치를 못 써요. ⚙ 설정에서 Shizuku를 켜거나, 어시스턴트 설정의 "스크린샷 사용"을 켜세요.'); return; }
    const w = box.r - box.l, h = box.b - box.t, pad = Math.max(14, .08 * Math.max(w, h));
    const R = { l: Math.max(6, box.l - pad), t: Math.max(6, box.t - pad), r: Math.min(innerWidth - 6, box.r + pad), b: Math.min(innerHeight - 6, box.b + pad) };
    const rw = R.r - R.l, rh = R.b - R.t;
    Object.assign(sel.style, { left: R.l + 'px', top: R.t + 'px', width: rw + 'px', height: rh + 'px' }); hasSel = true; sel.classList.add('on');
    if (selAnim) selAnim.cancel();
    selAnim = sel.animate([
      { opacity: 0, transform: `scale(${(w / rw * .9).toFixed(3)}, ${(h / rh * .9).toFixed(3)})`, offset: 0 },
      { opacity: 1, transform: 'scale(1.045, 1.06)', offset: .5 }, { transform: 'scale(.985, .99)', offset: .75 }, { opacity: 1, transform: 'none', offset: 1 },
    ], { duration: 1000, easing: FX.easing('out'), fill: 'both' });
    Face.poke(.6); setTimeout(() => cv.classList.add('gone'), 250); setTimeout(() => { if (!drawing) { clearStroke(); cv.classList.remove('gone'); } }, 900);
    searchRegion(R);
  }
  function hideSel() {
    if (!hasSel) return; hasSel = false; const a = sel.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.96)' }], { duration: 320, easing: 'ease-out', fill: 'forwards' });
    a.onfinish = () => { if (selAnim) selAnim.cancel(); a.cancel(); sel.classList.remove('on', 'scan'); };
  }

  // ================= 써클 투 서치: 선택 영역을 잘라 이미지를 이해하는 AI에게 물어본다 =================
  const SYS = `사용자가 휴대폰 화면의 일부를 동그라미로 골라 "이게 뭐야?"라고 물었습니다. 이미지는 그 영역을 잘라낸 것입니다.
규칙: 한국어로 답합니다. 첫 줄은 정확히 [검색어:구글에서 이걸 찾기에 가장 좋은 검색어 하나] 형식으로 씁니다. 그 다음 줄부터 2~3문장으로 설명합니다.
- 상품이면 이름·종류·특징, 글자면 번역·요약, 장소·인물·동식물·음식이면 무엇인지, 에러/UI면 무슨 뜻인지 알려줍니다.
- 확실하지 않으면 추측임을 밝히고, 보이는 단서를 말해 줍니다.`;
  async function searchRegion(R) {
    busy = true; resetIdle(); setState('thinking'); Face.setMood('thinking'); Face.doMotion('tilt'); say2('🔍 살펴보는 중…'); acts.style.display = 'none'; sel.classList.add('scan');
    try {
      const kx = shotImg.naturalWidth / innerWidth, ky = shotImg.naturalHeight / innerHeight;
      const sx = R.l * kx, sy = R.t * ky, sw = (R.r - R.l) * kx, sh = (R.b - R.t) * ky, sc = Math.min(1, 1024 / Math.max(sw, sh));
      const oc = document.createElement('canvas'); oc.width = Math.round(sw * sc); oc.height = Math.round(sh * sc);
      oc.getContext('2d').drawImage(shotImg, sx, sy, sw, sh, 0, 0, oc.width, oc.height);
      const data = oc.toDataURL('image/jpeg', 0.88).split(',')[1];
      const s = await window.api.getSettings();
      if (s.provider === 'pollinations') throw new Error('이미지를 이해하는 AI가 필요해요. ⚙ 설정에서 제공자를 Google Gemini(무료)로 바꾸고 키를 넣어 주세요.');
      if (!s.apiKey) throw new Error('API 키가 없어요. ⚙ 설정에서 키를 넣어 주세요.');
      const r = await window.LLM.call({ provider: s.provider, apiKey: s.apiKey, model: s.model, system: SYS, maxTokens: 700,
        messages: [{ role: 'user', content: [{ type: 'text', text: '동그라미 친 부분이 뭐야?' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }] }] });
      let text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      let q = ''; const m = text.match(/^\s*\[검색어:([^\]]+)\]\s*/); if (m) { q = m[1].trim(); text = text.slice(m[0].length); }
      busy = false; sel.classList.remove('scan'); Face.setMood('happy'); Face.doMotion('wave'); Face.poke(.8); say2(text); setState(null);
      acts.innerHTML = ''; acts.style.display = 'flex';
      const mk = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = (e) => { e.stopPropagation(); fn(); }; acts.appendChild(b); };
      if (q) mk('🔍 구글에서 검색', '', async () => { await D.openIntent({ uri: 'https://www.google.com/search?q=' + encodeURIComponent(q) }); D.closeAssist(); });
      mk('다시 그리기', 'sub', () => { acts.style.display = 'none'; hideSel(); clearStroke(); say2('검색할 곳을 다시 그려 보세요'); try { D.stopSpeak(); } catch {} });
      resetIdle(); await talk(text.replace(/[`*#_>]/g, '').slice(0, 220));
    } catch (e) {
      busy = false; sel.classList.remove('scan'); setState(null); Face.setMood('sad'); Face.doMotion('droop'); say2('⚠ ' + (e && e.message ? e.message : e)); resetIdle();
    }
  }

  // ================= 음성: 얼굴을 터치하면 듣기 =================
  function micDenied() {
    busy = false; setState(null); Face.setMood('sad'); Face.doMotion('droop'); say2('마이크 권한이 필요해요. 설정 → 권한 → 마이크 → 허용으로 바꿔 주세요.');
    acts.innerHTML = ''; acts.style.display = 'flex';
    const b = document.createElement('button'); b.textContent = '⚙ 권한 설정 열기'; b.onclick = async (e) => { e.stopPropagation(); await D.openAppInfo(); D.closeAssist(); }; acts.appendChild(b); resetIdle();
  }
  async function listen() {
    if (busy || (window.isBusy && window.isBusy())) return; busy = true; resetIdle(); hideSel(); clearStroke(); acts.style.display = 'none';
    try { D.stopSpeak(); } catch {}
    setState('listening'); Face.poke(1); Face.setMood('surprised'); Face.doMotion('jump'); say2('🎤 준비 중…');
    try {
      await window.voiceTurn({
        onStatus: (t, ph) => { say2(t); if (ph === 'transcribing') setState('thinking'); }, onSpeech: () => say2('🎤 듣고 있어요…'),
        onPartial: (t) => window.showUser && window.showUser(t, true), onLevel: (l) => root.style.setProperty('--lvl', Number(l).toFixed(2)),
        onRecorded: () => { root.style.setProperty('--lvl', 0); setState('thinking'); },
      });
      root.style.setProperty('--lvl', 0); busy = false;
    } catch (e) {
      busy = false; setState(null); root.style.setProperty('--lvl', 0);
      if (e.code === 'mic') { micDenied(); return; }
      Face.setMood('sad'); Face.doMotion('droop');
      say2(e.code === 'silence' ? '말소리가 들리지 않았어요. 얼굴을 눌러 다시 말해 주세요.' : (e && e.message ? e.message : '잘 못 들었어요.') + ' 얼굴을 눌러 다시 말해 주세요.'); resetIdle();
    }
  }
  face.addEventListener('click', (e) => { e.stopPropagation(); listen(); });

  // 답이 스트리밍으로 오는 동안 첫 문장이 완성되면 바로 소리 내기 시작한다 (끝까지 기다리지 않음)
  let firstTalk = null, firstLen = 0;
  const clean = (t) => String(t || '').replace(/[`*#_>]/g, '');
  window.AuroraAssist = {
    onTurnStart: () => { firstTalk = null; firstLen = 0; try { D.stopSpeak(); } catch {} },
    onDelta: (t) => {
      if (firstTalk) return; const c = clean(t), m = c.match(/^[\s\S]*?[.!?。！？]+(?=\s|$)|^[^\n]+\n/);
      if (m && m[0].trim().length >= 6) { firstLen = m[0].length; firstTalk = talk(m[0].trim()); }
    },
    onAnswer: async (r) => {
      busy = false; resetIdle(); setState(null);
      const spoken = clean(r.text).slice(0, 300);
      if (r.stay) { say(spoken); setTimeout(() => D.closeAssist(), 120); return; }   // 앱을 열었으면 오버레이를 바로 닫아 앱이 보이게
      if (firstTalk) { const rest = spoken.slice(firstLen).trim(); await firstTalk; if (rest) await talk(rest); }
      else await talk(spoken);
      resetIdle();
    },
  };

  // 미리 데우기: AI 서버 연결 + 설치된 앱 목록 (첫 명령이 바로 실행되도록)
  try { window.api.getSettings().then((s) => { if (window.LLM) LLM.warm(s.provider); }); window.PhoneAgent && PhoneAgent.vocab(); } catch {}

  say2('무엇을 도와드릴까요?'); Face.setMood('happy'); Face.doMotion('wave'); Face.poke(.8);
  await talk('무엇을 도와드릴까요?'); resetIdle();
})();
