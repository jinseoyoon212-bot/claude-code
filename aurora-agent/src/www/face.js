// 둥글둥글 무지개 오로라 얼굴 — 스프링 물리 기반의 말랑한 움직임
const Face = (() => {
  const cv = document.getElementById('face'), g = cv.getContext('2d');
  const W = cv.width, C = W / 2, R = 180;
  let mood = 'neutral', t = 0, talking = false, talkLevel = 0, blink = 0, nextBlink = 2, saccadeT = 1;
  const INK = '#3b2358';

  // 스프링: 목표값을 향해 탄력 있게 움직임
  const spring = (x = 0, k = 90, d = 9) => ({ x, v: 0, to: x, k, d });
  const step = (s, dt) => { const a = s.k * (s.to - s.x) - s.d * s.v; s.v += a * dt; s.x += s.v * dt; };
  const B = { dx: spring(0, 60, 7), dy: spring(0, 70, 6), rot: spring(0, 70, 6), sq: spring(0, 120, 8) };
  const gaze = { x: spring(0, 40, 9), y: spring(0, 40, 9) };

  // 표정 파라미터(모두 스프링으로 부드럽게 전환)
  const P = {
    neutral:  { eye: 1,   happy: 0, size: 1,    smile: 0.55, open: 0,    cheek: 0.45, lid: 0,   brow: 0 },
    happy:    { eye: 0.9, happy: 1, size: 1,    smile: 1,    open: 0.35, cheek: 1,    lid: 0,   brow: 0 },
    laugh:    { eye: 0.9, happy: 1, size: 1,    smile: 1,    open: 1,    cheek: 1,    lid: 0,   brow: 0 },
    sad:      { eye: 1,   happy: 0, size: 1.1,  smile: -0.7, open: 0,    cheek: 0.1,  lid: 0.25, brow: -1 },
    angry:    { eye: 0.85, happy: 0, size: 0.95, smile: -0.35, open: 0,   cheek: 0.7,  lid: 0.3, brow: 1 },
    surprised:{ eye: 1.15, happy: 0, size: 1.25, smile: 0,    open: 0.8,  cheek: 0.3,  lid: 0,   brow: 0 },
    thinking: { eye: 1,   happy: 0, size: 1,    smile: 0.1,  open: 0,    cheek: 0.35, lid: 0,   brow: 0 },
    sleepy:   { eye: 0.15, happy: 0, size: 1,   smile: 0.25, open: 0.15, cheek: 0.4,  lid: 0,   brow: 0 },
    love:     { eye: 1,   happy: 0, size: 1,    smile: 1,    open: 0.25, cheek: 1,    lid: 0,   brow: 0 },
  };
  const cur = {}; for (const k in P.neutral) cur[k] = spring(P.neutral[k], 70, 10);

  const RULES = [
    [/사랑|좋아해|하트|♥|❤|고마워|감사|최고/, 'love', 'bounce'],
    [/ㅋㅋ|ㅎㅎ|웃기|재밌|하하|lol/i, 'laugh', 'bounce'],
    [/슬프|우울|힘들|ㅠㅠ|ㅜㅜ|눈물|외로|미안/, 'sad', 'droop'],
    [/화나|짜증|싫어|열받|최악|바보|꺼져/, 'angry', 'shake'],
    [/헉|놀라|대박|우와|와!|진짜\?|뭐\?!|!!/, 'surprised', 'jump'],
    [/졸려|잘자|피곤|굿나잇|zzz/i, 'sleepy', 'sway'],
    [/\?|뭐|왜|어떻게|알려|찾아|검색|실행|열어|만들어|저장|삭제/, 'thinking', 'tilt'],
    [/안녕|하이|반가|hello|hi\b|좋아|기뻐|행복|신나|yay|굿/i, 'happy', 'wave'],
  ];

  function setMood(m) { mood = P[m] ? m : 'neutral'; for (const k in cur) cur[k].to = P[mood][k]; }
  // 움직임은 스프링에 "톡" 힘을 줘서 만든다 → 말랑하고 자연스럽게 흔들렸다 가라앉음
  const timers = [];
  const later = (ms, fn) => timers.push({ at: t + ms / 1000, fn });
  function doMotion(m) {
    timers.length = 0;
    switch (m) {
      case 'bounce': for (let i = 0; i < 3; i++) later(i * 380, () => { B.dy.v = -520 + i * 80; B.sq.v = -2; }); break;
      case 'jump': B.sq.v = 6; later(120, () => { B.dy.v = -900; B.sq.v = -4; }); break;
      case 'shake': for (let i = 0; i < 6; i++) later(i * 90, () => { B.dx.v = (i % 2 ? -1 : 1) * 420; B.rot.v = (i % 2 ? 1 : -1) * 1.2; }); break;
      case 'droop': B.dy.to = 22; B.sq.to = 0.05; later(1800, () => { B.dy.to = 0; B.sq.to = 0; }); break;
      case 'sway': for (let i = 0; i < 3; i++) later(i * 700, () => { B.rot.v = (i % 2 ? -1 : 1) * 1.4; }); break;
      case 'tilt': B.rot.to = 0.2; later(2200, () => (B.rot.to = 0)); gaze.y.to = -0.6; later(2200, () => (gaze.y.to = 0)); break;
      case 'nod': B.dy.v = 220; later(220, () => (B.dy.v = 180)); break;
      case 'wave': for (let i = 0; i < 4; i++) later(i * 220, () => { B.rot.v = (i % 2 ? -1 : 1) * 1.6; B.dy.v = -120; }); break;
    }
  }
  function react(text) {
    for (const [re, m, mo] of RULES) if (re.test(text)) { setMood(m); doMotion(mo); return m; }
    setMood('neutral'); doMotion('nod'); return 'neutral';
  }
  function lookAt(x, y) { gaze.x.to = x; gaze.y.to = y; }
  let mouseOn = 0;
  addEventListener('mousemove', (e) => { const r = cv.getBoundingClientRect(); lookAt(Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / 260)), Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / 260))); mouseOn = t; });

  // ---------- 그리기 ----------
  function blob(cx, cy, r, stops) {
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    stops.forEach(([o, c]) => rg.addColorStop(o, c)); g.fillStyle = rg; g.fillRect(-R, -R, R * 2, R * 2);
  }
  function drawBody() {
    g.beginPath(); g.arc(0, 0, R, 0, 7); g.save(); g.clip();
    const cg = g.createConicGradient(t * 0.35, 0, 0);
    ['#ff9ad0', '#ffd08a', '#fff39a', '#a6ffcf', '#9be7ff', '#b7a6ff', '#e5a6ff', '#ff9ad0'].forEach((c, i, a) => cg.addColorStop(i / (a.length - 1), c));
    g.fillStyle = cg; g.fillRect(-R, -R, R * 2, R * 2);
    blob(0, 0, R, [[0, 'rgba(255,255,255,.55)'], [0.7, 'rgba(255,255,255,.18)'], [1, 'rgba(255,255,255,0)']]);   // 파스텔로 부드럽게
    for (let i = 0; i < 3; i++) { const a = t * (0.3 + i * 0.13) + i * 2.1; blob(Math.cos(a) * 90, Math.sin(a * 1.2) * 90, 130, [[0, `hsla(${(t * 40 + i * 120) % 360},100%,85%,.5)`], [1, 'rgba(255,255,255,0)']]); }
    blob(-70, -90, 120, [[0, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]);   // 몽글한 하이라이트
    blob(40, 120, 150, [[0, 'rgba(180,130,255,.0)'], [1, 'rgba(150,100,230,.22)']]);
    g.restore();
  }
  function drawEye(x, y, side) {
    const s = cur.size.x, open = cur.eye.x * (1 - blink) , hp = Math.max(0, Math.min(1, cur.happy.x));
    const gx = gaze.x.x * 7, gy = gaze.y.x * 6;
    g.save(); g.translate(x + gx, y + gy);
    if (mood === 'love') { heart(0, 0, 26 * (1 + Math.sin(t * 6) * 0.06)); g.restore(); return; }
    g.strokeStyle = INK; g.lineCap = 'round'; g.lineWidth = 9;
    if (hp > 0.5 || open < 0.2) {                              // ^ ^ 또는 감은 눈 : 둥근 아치
      g.beginPath();
      if (hp > 0.5) g.arc(0, 8, 20, Math.PI * 1.1, Math.PI * 1.9); else { g.moveTo(-18, 0); g.quadraticCurveTo(0, 10, 18, 0); }
      g.stroke(); g.restore(); return;
    }
    const r = 19 * s, sy = Math.max(0.08, open);
    g.fillStyle = INK; g.beginPath(); g.ellipse(0, 0, r, r * sy, 0, 0, 7); g.fill();       // 동글동글 까만 눈
    if (sy > 0.4) {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(-r * 0.32, -r * 0.34 * sy, r * 0.36, 0, 7); g.fill();  // 큰 하이라이트
      g.beginPath(); g.arc(r * 0.34, r * 0.3 * sy, r * 0.17, 0, 7); g.fill();                        // 작은 하이라이트
    }
    const lid = cur.lid.x;                                     // 눈꺼풀: 슬픔/화남을 부드럽게
    if (lid > 0.02) {
      g.fillStyle = '#d9b4ff'; g.save(); g.beginPath(); g.ellipse(0, 0, r + 1, r * sy + 1, 0, 0, 7); g.clip();
      g.rotate(cur.brow.x * side * 0.35); g.fillRect(-r - 4, -r - 4, r * 2 + 8, (r * 2 + 8) * lid * 0.9); g.restore();
    }
    g.restore();
  }
  function heart(x, y, s) {
    g.fillStyle = '#ff6fa3'; g.beginPath(); g.moveTo(x, y + s * 0.7);
    g.bezierCurveTo(x - s * 1.3, y - s * 0.1, x - s * 0.7, y - s * 1.1, x, y - s * 0.4);
    g.bezierCurveTo(x + s * 0.7, y - s * 1.1, x + s * 1.3, y - s * 0.1, x, y + s * 0.7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x - s * 0.4, y - s * 0.35, s * 0.15, 0, 7); g.fill();
  }
  function drawFace() {
    const ex = 66, ey = -10;
    drawEye(-ex, ey, 1); drawEye(ex, ey, -1);
    // 동글동글 볼터치
    const ck = cur.cheek.x;
    [-1, 1].forEach((sd) => { const cx = sd * 108, cy = 36; const rg = g.createRadialGradient(cx, cy, 0, cx, cy, 30); rg.addColorStop(0, `rgba(255,105,160,${0.25 + ck * 0.5})`); rg.addColorStop(1, 'rgba(255,105,160,0)'); g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, 30, 0, 7); g.fill(); });
    // 동그란 코
    g.fillStyle = '#8a4a78'; g.beginPath(); g.arc(0, 28, 7, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(-2, 26, 2.2, 0, 7); g.fill();
    // 작고 동그란 입
    const target = talking ? (0.35 + (Math.sin(t * 13) * 0.5 + 0.5) * 0.5) * (0.6 + 0.4 * Math.sin(t * 5.3)) : 0;
    talkLevel += (target - talkLevel) * 0.25;
    const open = Math.min(1, cur.open.x + talkLevel), sm = cur.smile.x;
    g.save(); g.translate(0, 56); g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = INK;
    if (open > 0.1) {                                          // 동그란 입 (ㅇ / D 모양)
      const w = 15 + 14 * Math.max(0, sm) + 5 * open, h = 6 + 24 * open;
      g.beginPath(); g.moveTo(-w, 0); g.quadraticCurveTo(0, sm * 6, w, 0); g.bezierCurveTo(w, h * 1.1, -w, h * 1.1, -w, 0); g.closePath();
      g.fillStyle = '#6a2447'; g.fill(); g.stroke();
      g.save(); g.clip(); g.fillStyle = '#ff8fb0'; g.beginPath(); g.ellipse(0, h, w * 0.6, h * 0.45, 0, 0, 7); g.fill(); g.restore();
    } else {                                                   // 귀여운 작은 미소 (ω 느낌 없이 단순 곡선)
      const w = 20 + 8 * Math.abs(sm);
      g.beginPath(); g.moveTo(-w, -sm * 3); g.quadraticCurveTo(0, sm * 20 + 2, w, -sm * 3); g.stroke();
    }
    g.restore();
    // 말풍선 대신 작은 이펙트
    if (mood === 'thinking') { g.fillStyle = 'rgba(150,128,255,.78)'; [[112, -112, 5], [130, -134, 8], [154, -164, 12]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y + Math.sin(t * 3 + r) * 3, r, 0, 7); g.fill(); }); }
    if (mood === 'sleepy') { g.fillStyle = '#a392ff'; g.font = 'bold 32px sans-serif'; g.fillText('z', 112, -86 + Math.sin(t * 2) * 6); g.font = 'bold 22px sans-serif'; g.fillText('z', 140, -118 + Math.sin(t * 2 + 1) * 6); }
    if (mood === 'sad') { g.fillStyle = '#9bdcff'; const k = (t * 0.6) % 1; g.globalAlpha = 1 - k * 0.6; g.beginPath(); g.ellipse(-ex - 8, ey + 20 + k * 80, 6, 9, 0, 0, 7); g.fill(); g.globalAlpha = 1; }
    if (mood === 'angry') { g.fillStyle = 'rgba(255,100,130,.9)'; g.font = 'bold 30px sans-serif'; g.fillText('💢', 100, -110); }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000); last = now; t += dt;
    for (let i = timers.length - 1; i >= 0; i--) if (t >= timers[i].at) { const f = timers.splice(i, 1)[0].fn; f(); }
    for (const k in B) step(B[k], dt); for (const k in cur) step(cur[k], dt); step(gaze.x, dt); step(gaze.y, dt);
    // 마우스가 오래 가만있으면 시선이 자연스럽게 두리번
    saccadeT -= dt; if (saccadeT < 0 && t - mouseOn > 4) { lookAt((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8); saccadeT = 1.5 + Math.random() * 2.5; }
    // 눈 깜빡임(부드럽게 감았다 뜸)
    nextBlink -= dt; if (nextBlink < 0) { blink = 1; nextBlink = 2.2 + Math.random() * 3.5; if (Math.random() < 0.2) nextBlink = 0.25; }
    blink = Math.max(0, blink - dt * 7);
    // 숨쉬기 + 둥실둥실
    const br = Math.sin(t * 1.9), idleY = Math.sin(t * 1.3) * 7, idleX = Math.sin(t * 0.7) * 3, idleR = Math.sin(t * 0.9) * 0.025;
    const sq = B.sq.x + br * 0.012;                      // 눌림(+)이면 납작하게
    const sx = 1 + sq, sy = 1 - sq * 1.1;
    g.clearRect(0, 0, W, W);
    // 바닥 그림자 (점프하면 작아짐)
    const sh = Math.max(0.5, 1 - (-(B.dy.x + idleY)) / 220);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(C + B.dx.x, C + R + 28, R * 0.6 * sh, 14 * sh, 0, 0, 7); g.fill();
    g.save(); g.translate(C + B.dx.x + idleX, C + B.dy.x + idleY); g.rotate(B.rot.x + idleR); g.scale(sx, sy);
    drawBody(); drawFace(); g.restore();
    requestAnimationFrame(frame);
  }
  setMood('neutral'); requestAnimationFrame(frame);
  return { setMood, doMotion, react, setTalking: (v) => (talking = v), lookAt };
})();
