// 모션 엔진: 스프링 이징, 젤리(찌그러짐/늘어남), 보내기 → 풍선으로 "쭉 빨려 올라가는" 액체 효과
const FX = (() => {
  const root = document.documentElement;
  const easing = (name = 'spring') => { const v = getComputedStyle(root).getPropertyValue('--' + name).trim(); return v || 'cubic-bezier(.34,1.56,.64,1)'; };
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function jelly(el, cls = 'jelly') { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  document.addEventListener('animationend', (e) => { if (e.target.classList && e.target.classList.contains('jelly')) e.target.classList.remove('jelly'); });

  /**
   * text를 from(출발 사각형)에서 ubub(위 풍선) 자리로 쭉 빨려 올라가게 한다.
   * 1) 출발 지점에서 살짝 웅크림(예비동작) 2) 위로 가속하며 가늘고 길게 늘어남 3) 도착 때 통통 눌렸다 정착
   * 뒤쪽에는 액체 방울이 따라오며 끈적하게 이어진다(고이 SVG 필터).
   */
  function flyUp(text, from, ubub) {
    return new Promise((resolve) => {
      const done = () => { ubub.style.visibility = ''; ubub.classList.add('in'); resolve(); };
      try {
        ubub.classList.remove('fade', 'in'); ubub.textContent = text;
        if (reduce() || !ubub.animate) { done(); return; }
        ubub.style.visibility = 'hidden'; ubub.classList.add('measure');
        const to = ubub.getBoundingClientRect(); ubub.classList.remove('measure');
        if (!to.width || !to.height) { done(); return; }

        const fx = from.left + from.width / 2, fy = from.top + from.height / 2, tx = to.left + to.width / 2, ty = to.top + to.height / 2;
        const dx = fx - tx, dy = fy - ty, dist = Math.hypot(dx, dy);
        const sx = clamp(from.width / to.width, .22, 2.2), sy = clamp(from.height / to.height, .35, 1.4);
        const side = (dx >= 0 ? -1 : 1) * Math.min(18, dist * .05);                 // 살짝 곡선을 그리며 올라감

        const el = document.createElement('div'); el.className = 'fly'; el.textContent = text;
        Object.assign(el.style, { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px' });
        document.body.appendChild(el);

        // 방울(고이 효과): 출발점에서 같은 길을 시간차로 따라온다
        let fxl = document.getElementById('fx'); if (!fxl) { fxl = document.createElement('div'); fxl.id = 'fx'; document.body.appendChild(fxl); }
        const N = 9, drops = [];
        for (let i = 0; i < N; i++) {
          const d = document.createElement('i'); d.className = 'drop'; const sz = 22 - i * 1.6; d.style.cssText = `left:${fx - sz / 2}px;top:${fy - sz / 2}px;width:${sz}px;height:${sz}px`;
          fxl.appendChild(d); drops.push(d);
          d.animate([
            { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
            { transform: `translate(${(tx - fx) * .5 + side * 1.4}px,${(ty - fy) * .5}px) scale(${1 - i * .05})`, opacity: 1, offset: .6 },
            { transform: `translate(${tx - fx}px,${ty - fy - 4}px) scale(.35)`, opacity: .0, offset: 1 },
          ], { duration: 520 + i * 28, delay: i * 34, easing: 'cubic-bezier(.55,0,.2,1)', fill: 'both' });
        }

        const T = (x, y, a, b) => `translate(${x}px,${y}px) scale(${a},${b})`;
        const dur = clamp(560 + dist * .55, 700, 1100);
        const anim = el.animate([
          { transform: T(dx, dy, sx, sy), opacity: 1, offset: 0, easing: 'cubic-bezier(.3,0,.5,1)' },
          { transform: T(dx, dy + 7, sx * 1.05, sy * .8), offset: .14, easing: 'cubic-bezier(.55,.05,.35,1)' },                  // 웅크림
          { transform: T(dx * .55 + side, dy * .55, .56, 1.7), offset: .46, easing: 'cubic-bezier(.4,0,.2,1)' },                   // 길게 늘어나며 빨려 올라감
          { transform: T(side * .2, -dist * .035 - 8, 1.1, .86), offset: .78, easing: 'cubic-bezier(.3,.9,.4,1)' },               // 도착: 위로 살짝 넘치며 납작
          { transform: T(0, 3, .975, 1.04), offset: .9, easing: 'cubic-bezier(.3,.9,.4,1)' },
          { transform: T(0, 0, 1, 1), opacity: 1, offset: 1 },
        ], { duration: dur, fill: 'both' });
        anim.onfinish = () => { el.remove(); drops.forEach((d) => d.remove()); done(); jelly(ubub, 'land'); };
        anim.oncancel = () => { el.remove(); drops.forEach((d) => d.remove()); done(); };
      } catch { done(); }
    });
  }
  return { easing, jelly, flyUp, clamp };
})();
