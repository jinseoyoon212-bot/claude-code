// 어시스턴트 오버레이: 말하기(음성 인식) + 써클 투 서치(화면을 동그라미로 선택해 AI에게 물어보기)
(async () => {
  const D = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AuroraDevice;
  if (!D || !D.isAssistMode) return;
  let st; try { st = await D.isAssistMode(); } catch { return; }
  if (!st.assist) return;

  const root = document.documentElement; root.classList.add('assist');
  const bubble = document.getElementById('bubble'), face = document.getElementById('face'), input = document.getElementById('input'), form = document.getElementById('form');
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
  const acts = document.createElement('div'); acts.id = 'acts'; face.after(acts);
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
  D.addListener('speechPartial', (e) => { if (busy) bubble.textContent = '🎤 ' + e.text; });
  let lastRms = 0; D.addListener('speechRms', (e) => { const now = Date.now(); if (now - lastRms < 60) return; lastRms = now; root.style.setProperty('--lvl', Math.max(0, Math.min(1, (e.rms + 2) / 12)).toFixed(2)); });

  async function listen() {
    if (busy) return; busy = true; resetIdle(); clearStroke(); acts.style.display = 'none';
    try { D.stopSpeak(); } catch {}
    setState('listening'); Face.setMood('surprised'); Face.doMotion('jump'); bubble.textContent = '🎤 준비 중…';
    try {
      let bias = []; try { bias = await window.PhoneAgent.vocab(); } catch {}
      const r = await D.listen({ biasing: bias });
      // 후보 중 우리가 아는 명령/앱 이름과 가장 잘 맞는 문장을 고른다 (없으면 1순위)
      let best = r.text, bs = -1; const texts = r.texts && r.texts.length ? r.texts : [r.text];
      for (let i = 0; i < texts.length; i++) { let sc = 0; try { sc = await window.PhoneAgent.matchScore(texts[i]); } catch {} sc += (r.scores && r.scores[i] || 0) * 0.5 - i * 0.05; if (sc > bs) { bs = sc; best = texts[i]; } }
      root.style.setProperty('--lvl', 0); setState('thinking');
      bubble.textContent = best; input.value = best; form.requestSubmit();     // 이후는 기존 대화/명령 로직(renderer.js)이 처리
    } catch (e) {
      busy = false; setState(null); root.style.setProperty('--lvl', 0); Face.setMood('sad'); Face.doMotion('droop');
      bubble.textContent = (e && e.message ? e.message : '잘 못 들었어요.') + ' 얼굴을 눌러 다시 말해 주세요.'; resetIdle();
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
