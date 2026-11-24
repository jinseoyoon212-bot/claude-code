// 모션 엔진: 스프링 이징, 젤리(찌그러짐/늘어남), 보내기 → 풍선으로 "쭉 빨려 올라가는" 액체 효과
const FX = (() => {
  const root = document.documentElement;
  const easing = (name = 'spring') => { const v = getComputedStyle(root).getPropertyValue('--' + name).trim(); return v || 'cubic-bezier(.34,1.56,.64,1)'; };
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function jelly(el, cls = 'jelly') { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  document.addEventListener('animationend', (e) => { if (e.target.classList && e.target.classList.contains('jelly')) e.target.classList.remove('jelly'); });

  /** 보낸 글을 얼굴 아래 풍선에 내려앉히며 보여준다 (글이 위로 날아가는 연출은 쓰지 않는다) */
  function settle(text, ubub) {
    return new Promise((resolve) => {
      clearTimeout(ubub._t); ubub.classList.remove('fade', 'in', 'drop-in'); ubub.textContent = text; ubub.style.visibility = '';
      void ubub.offsetWidth; ubub.classList.add('in', 'drop-in');
      ubub._t = setTimeout(() => { ubub.classList.remove('drop-in'); resolve(); }, 520);
    });
  }
  return { easing, jelly, settle, clamp };
})();
