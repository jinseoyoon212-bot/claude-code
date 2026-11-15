// 어시스턴트 오버레이: "무엇을 도와드릴까요?" 말하기 → 얼굴 터치 → 음성 인식 → 답변을 소리로 말하기
(async () => {
  const D = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AuroraDevice;
  if (!D || !D.isAssistMode) return;
  let st; try { st = await D.isAssistMode(); } catch { return; }
  if (!st.assist) return;

  document.documentElement.classList.add('assist');
  const aura = document.createElement('div'); aura.id = 'aura'; document.body.prepend(aura);
  const bubble = document.getElementById('bubble'), face = document.getElementById('face'), input = document.getElementById('input'), form = document.getElementById('form');
  let busy = false, idle;
  const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => D.closeAssist(), 30000); };
  const say = async (t) => { try { await D.speak({ text: t }); } catch {} };
  const talk = async (t) => { Face.setTalking(true); await say(t); Face.setTalking(false); };

  D.addListener('speechPartial', (e) => { if (busy) bubble.textContent = '🎤 ' + e.text; });

  async function listen() {
    if (busy) return; busy = true; resetIdle();
    try { D.stopSpeak(); } catch {}
    Face.setMood('surprised'); Face.doMotion('jump'); bubble.textContent = '🎤 듣고 있어요…';
    try {
      const { text } = await D.listen();
      bubble.textContent = text; input.value = text; form.requestSubmit();        // 이후 흐름은 기존 대화 로직(renderer.js)이 처리
    } catch (e) {
      busy = false; Face.setMood('sad'); Face.doMotion('droop');
      bubble.textContent = (e && e.message ? e.message : '잘 못 들었어요.') + ' 얼굴을 눌러 다시 말해 주세요.'; resetIdle();
    }
  }
  face.addEventListener('click', (e) => { e.stopPropagation(); listen(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#face,#bubble')) D.closeAssist(); });

  window.AuroraAssist = {
    onAnswer: async (r) => {
      busy = false; resetIdle();
      const spoken = String(r.text || '').replace(/[`*#_>]/g, '').slice(0, 300);
      if (r.stay) { say(spoken); setTimeout(() => D.closeAssist(), 500); return; }   // 앱을 열었으면 오버레이를 닫아 앱이 보이게
      await talk(spoken); resetIdle();
    },
  };

  bubble.textContent = '무엇을 도와드릴까요?'; Face.setMood('happy'); Face.doMotion('wave');
  await talk('무엇을 도와드릴까요?'); resetIdle();
})();
