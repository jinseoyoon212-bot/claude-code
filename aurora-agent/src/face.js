// 무지개 오로라 얼굴: 표정(mood)과 움직임(motion)을 가진 캔버스 캐릭터
const Face = (() => {
  const cv = document.getElementById('face'), g = cv.getContext('2d');
  const W = cv.width, C = W / 2, R = 190;
  let mood = 'neutral', t = 0, motion = null, motionT = 0, talking = false, blinkT = 0, nextBlink = 2;
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  // 현재 표정 파라미터(부드럽게 보간)
  const cur = { eyeOpen: 1, eyeH: 1, mouthW: 1, mouthCurve: 0.5, mouthOpen: 0, brow: 0, cheek: 0.5, tilt: 0 };
  const P = {
    neutral:  { eyeOpen: 1, eyeH: 1, mouthW: 0.8, mouthCurve: 0.4, mouthOpen: 0, brow: 0, cheek: 0.4, tilt: 0 },
    happy:    { eyeOpen: 0.55, eyeH: 1, mouthW: 1.1, mouthCurve: 1, mouthOpen: 0.25, brow: -0.2, cheek: 1, tilt: 0 },
    laugh:    { eyeOpen: 0.15, eyeH: 1, mouthW: 1.3, mouthCurve: 1, mouthOpen: 1, brow: -0.3, cheek: 1, tilt: 0 },
    sad:      { eyeOpen: 0.8, eyeH: 1.1, mouthW: 0.7, mouthCurve: -0.8, mouthOpen: 0, brow: 0.9, cheek: 0, tilt: -0.08 },
    angry:    { eyeOpen: 0.7, eyeH: 0.8, mouthW: 0.8, mouthCurve: -0.5, mouthOpen: 0, brow: -1, cheek: 0.2, tilt: 0 },
    surprised:{ eyeOpen: 1.4, eyeH: 1.3, mouthW: 0.5, mouthCurve: 0, mouthOpen: 1, brow: -0.6, cheek: 0.2, tilt: 0 },
    thinking: { eyeOpen: 0.9, eyeH: 1, mouthW: 0.5, mouthCurve: 0, mouthOpen: 0, brow: 0.3, cheek: 0.3, tilt: 0.1 },
    sleepy:   { eyeOpen: 0.12, eyeH: 1, mouthW: 0.6, mouthCurve: 0.1, mouthOpen: 0.15, brow: 0.2, cheek: 0.3, tilt: 0.05 },
    love:     { eyeOpen: 1, eyeH: 1, mouthW: 1, mouthCurve: 1, mouthOpen: 0.2, brow: -0.2, cheek: 1, tilt: 0 },
  };
  // 사용자가 입력한 텍스트에서 즉시 감정 추정
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
  const lerp = (a, b, k) => a + (b - a) * k;
  function setMood(m) { mood = P[m] ? m : 'neutral'; }
  function doMotion(m) { motion = m; motionT = 0; }
  function react(text) {
    for (const [re, m, mo] of RULES) if (re.test(text)) { setMood(m); doMotion(mo); return m; }
    setMood('neutral'); doMotion('nod'); return 'neutral';
  }
  function lookAt(x, y) { look.tx = x; look.ty = y; }
  addEventListener('mousemove', (e) => { const r = cv.getBoundingClientRect(); lookAt(Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / 300)), Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / 300))); });

  function body(dx, dy, rot, sx, sy) {
    g.save(); g.translate(C + dx, C + dy); g.rotate(rot); g.scale(sx, sy);
    // 오로라 무지개 몸통: 회전하는 콘 그라디언트 + 흐르는 빛덩이
    const cg = g.createConicGradient(t * 0.6, 0, 0);
    ['#ff6ec7', '#ffb86b', '#fff56b', '#6bffb0', '#6be3ff', '#8c7bff', '#d76bff', '#ff6ec7'].forEach((c, i, a) => cg.addColorStop(i / (a.length - 1), c));
    g.beginPath(); g.arc(0, 0, R, 0, 7); g.fillStyle = cg; g.fill();
    g.save(); g.clip();
    for (let i = 0; i < 4; i++) {
      const a = t * (0.5 + i * 0.2) + i * 1.7, x = Math.cos(a) * R * 0.55, y = Math.sin(a * 1.3) * R * 0.55;
      const rg = g.createRadialGradient(x, y, 0, x, y, R * 0.7);
      rg.addColorStop(0, `hsla(${(t * 60 + i * 90) % 360},100%,80%,.55)`); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(-R, -R, R * 2, R * 2);
    }
    const sh = g.createRadialGradient(-R * 0.35, -R * 0.45, 5, 0, 0, R);
    sh.addColorStop(0, 'rgba(255,255,255,.55)'); sh.addColorStop(0.4, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(60,0,120,.28)');
    g.fillStyle = sh; g.fillRect(-R, -R, R * 2, R * 2);
    g.restore();
  }
  function eye(x, y, c) {
    const open = c.eyeOpen * (blinkT > 0 ? 0.05 : 1);
    g.save(); g.translate(x + look.x * 10, y + look.y * 8);
    const rx = 30, ry = Math.max(2, 34 * open * c.eyeH);
    if (mood === 'love') { heart(0, 0, 34); }
    else if ((mood === 'happy' || mood === 'laugh') && c.eyeOpen < 0.6) { // ^ ^ 모양
      g.strokeStyle = '#2a1650'; g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.arc(0, 10, 26, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    } else if (c.eyeOpen < 0.2) { g.strokeStyle = '#2a1650'; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(-26, 0); g.quadraticCurveTo(0, 14, 26, 0); g.stroke(); }
    else {
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 7); g.fill();
      g.fillStyle = '#2a1650'; g.beginPath(); g.ellipse(look.x * 8, look.y * 6, 19, Math.min(ry, 23), 0, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(look.x * 8 - 7, look.y * 6 - 8, 6, 0, 7); g.fill();
      g.beginPath(); g.arc(look.x * 8 + 7, look.y * 6 + 7, 3, 0, 7); g.fill();
    }
    g.restore();
  }
  function heart(x, y, s) {
    g.fillStyle = '#ff3d7f'; g.beginPath(); g.moveTo(x, y + s * 0.6);
    g.bezierCurveTo(x - s * 1.2, y - s * 0.2, x - s * 0.5, y - s * 0.95, x, y - s * 0.4);
    g.bezierCurveTo(x + s * 0.5, y - s * 0.95, x + s * 1.2, y - s * 0.2, x, y + s * 0.6); g.fill();
  }
  function brow(x, y, sign, c) {
    if (Math.abs(c.brow) < 0.15) return;
    g.save(); g.translate(x, y - 46); g.rotate(sign * c.brow * 0.45); g.strokeStyle = '#2a1650'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-24, 0); g.lineTo(24, 0); g.stroke(); g.restore();
  }
  function face(c) {
    const ex = 78, ey = -22;
    brow(-ex, ey, 1, c); brow(ex, ey, -1, c);
    eye(-ex, ey, c); eye(ex, ey, c);
    // 볼터치
    g.fillStyle = `rgba(255,90,150,${0.15 + c.cheek * 0.35})`;
    g.beginPath(); g.ellipse(-125, 38, 26, 15, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(125, 38, 26, 15, 0, 0, 7); g.fill();
    // 코
    g.fillStyle = '#2a1650'; g.beginPath(); g.ellipse(0, 22, 9, 6, 0, 0, 7); g.fill();
    // 입
    const talk = talking ? (Math.sin(t * 16) * 0.5 + 0.5) * 0.7 : 0;
    const open = Math.min(1, c.mouthOpen + talk), w = 46 * c.mouthW, cu = c.mouthCurve * 26;
    g.save(); g.translate(0, 62); g.lineWidth = 7; g.lineCap = 'round'; g.strokeStyle = '#2a1650';
    if (open > 0.12) {
      g.beginPath(); g.moveTo(-w, 0); g.quadraticCurveTo(0, cu * 1.6, w, 0); g.quadraticCurveTo(0, cu * 1.6 + 70 * open, -w, 0); g.closePath();
      g.fillStyle = '#5b1633'; g.fill(); g.stroke();
      g.save(); g.clip(); g.fillStyle = '#ff7d9c'; g.beginPath(); g.ellipse(0, 55 * open + cu * 0.8, w * 0.55, 18 * open, 0, 0, 7); g.fill(); g.restore();
    } else { g.beginPath(); g.moveTo(-w, 0); g.quadraticCurveTo(0, cu * 1.4, w, 0); g.stroke(); }
    g.restore();
    if (mood === 'thinking') { g.fillStyle = '#ffffffcc'; [[120, -120, 6], [140, -145, 9], [166, -178, 13]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y + Math.sin(t * 3 + r) * 3, r, 0, 7); g.fill(); }); }
    if (mood === 'sleepy') { g.fillStyle = '#fff'; g.font = 'bold 34px sans-serif'; g.fillText('z', 120, -90 + Math.sin(t * 2) * 6); g.font = 'bold 24px sans-serif'; g.fillText('z', 150, -125 + Math.sin(t * 2 + 1) * 6); }
    if (mood === 'sad') { g.fillStyle = '#7fd4ff'; const k = (t * 0.8) % 1; g.beginPath(); g.ellipse(-100, 5 + k * 90, 7, 11, 0, 0, 7); g.fill(); }
  }
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    const target = P[mood]; for (const k in cur) cur[k] = lerp(cur[k], target[k], 0.12);
    look.x = lerp(look.x, look.tx, 0.08); look.y = lerp(look.y, look.ty, 0.08);
    blinkT = Math.max(0, blinkT - dt); nextBlink -= dt; if (nextBlink < 0) { blinkT = 0.12; nextBlink = 2 + Math.random() * 3; }
    // 움직임
    let dx = 0, dy = Math.sin(t * 1.6) * 8, rot = cur.tilt + Math.sin(t * 0.9) * 0.02, sx = 1 + Math.sin(t * 1.6) * 0.012, sy = 1 - Math.sin(t * 1.6) * 0.012;
    if (motion) {
      motionT += dt; const k = motionT, fade = Math.max(0, 1 - k / 1.4);
      if (motion === 'bounce') dy -= Math.abs(Math.sin(k * 9)) * 40 * fade;
      if (motion === 'jump') { dy -= Math.max(0, Math.sin(Math.min(k, 0.6) / 0.6 * Math.PI)) * 70; sy *= 1 + Math.sin(k * 10) * 0.05 * fade; }
      if (motion === 'shake') dx += Math.sin(k * 40) * 14 * fade;
      if (motion === 'droop') { dy += 16 * Math.min(1, k * 2) * fade; sy *= 0.96; }
      if (motion === 'sway') rot += Math.sin(k * 3) * 0.1 * fade;
      if (motion === 'tilt') rot += 0.18 * Math.min(1, k * 4) * fade;
      if (motion === 'nod') dy += Math.sin(k * 10) * 10 * fade;
      if (motion === 'wave') { rot += Math.sin(k * 12) * 0.1 * fade; dx += Math.sin(k * 6) * 10 * fade; }
      if (k > 1.4) motion = null;
    }
    if (mood === 'thinking' && !motion) rot += Math.sin(t * 2) * 0.04;
    if (mood === 'sleepy') dy += Math.sin(t * 1) * 6;
    g.clearRect(0, 0, W, W);
    body(dx, dy, rot, sx, sy); face(cur); g.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { setMood, doMotion, react, setTalking: (v) => (talking = v), lookAt };
})();
