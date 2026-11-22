/**
 * iMessage-style "send" motion (visual only).
 *
 * When the user sends a message, the new outgoing bubble appears to be drawn up out of the composer
 * and settle into its place in the thread. Nothing about sending itself is touched: this only
 * watches the DOM for the bubble that the app already rendered and animates a visual copy of it.
 *
 * How it works
 *  - A send "intent" is recorded on Enter (without Shift) in the composer, or a press on the send
 *    button. Only a bubble that is added within INTENT_MS of an intent is animated, so history
 *    loading, received messages and conversation switches are never animated.
 *  - The real bubble is hidden (via CSS, data-lg-sent="flying") and a fixed-position ghost clone
 *    flies from the composer to the bubble's live position. A ghost is used because the message list
 *    is a scroll container that would clip a bubble travelling in from the composer.
 *  - The target is re-measured every frame, so a scroll-to-bottom that happens while it flies does
 *    not make it land in the wrong place. Only `transform` and `opacity` are animated.
 */

const INTENT_MS = 1500;
const DURATION_MS = 560;
const START_SCALE = 0.55;

let intentAt = 0;
const handled = new WeakSet<Element>();

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function markIntent() {
  intentAt = performance.now();
}

/** ease-out with a small overshoot (a spring that settles quickly) */
function spring(t: number) {
  const c1 = 1.25;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function fly(container: HTMLElement, bubble: HTMLElement) {
  const editor = document.querySelector<HTMLElement>('[data-testid="message-input-text-area"]');
  // layout size (offset*) is not affected by the entrance transform that may be running right now
  const size = { width: bubble.offsetWidth, height: bubble.offsetHeight };
  if (!size.width || !size.height) {
    return;
  }
  const target = bubble.getBoundingClientRect();

  const from = editor?.getBoundingClientRect();
  const startCx = (from ? from.left + 24 : target.left) + (size.width * START_SCALE) / 2;
  const startCy = from ? from.top + from.height / 2 : target.top + target.height / 2 + 60;

  const ghost = bubble.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: `${size.width}px`,
    height: `${size.height}px`,
    margin: '0',
    boxSizing: 'border-box',
    maxWidth: 'none',
    whiteSpace: 'nowrap',
    zIndex: '2147483000',
    pointerEvents: 'none',
    transformOrigin: 'center center',
    willChange: 'transform, opacity',
    opacity: '0',
  });

  container.setAttribute('data-lg-sent', 'flying');
  document.body.appendChild(ghost);

  const start = performance.now();

  const finish = () => {
    ghost.remove();
    container.setAttribute('data-lg-sent', 'done');
  };

  const frame = (now: number) => {
    if (!container.isConnected || !bubble.isConnected) {
      ghost.remove();
      return;
    }
    const t = Math.min(1, (now - start) / DURATION_MS);
    const e = spring(t);

    const live = bubble.getBoundingClientRect();
    const liveCx = live.left + live.width / 2;
    const liveCy = live.top + live.height / 2;
    const cx = lerp(startCx, liveCx, e);
    const cy = lerp(startCy, liveCy, e);
    const s = lerp(START_SCALE, 1, e);

    ghost.style.transform = `translate3d(${cx - size.width / 2}px, ${cy - size.height / 2}px, 0) scale(${s})`;
    ghost.style.opacity = String(Math.min(1, t / 0.18));

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      finish();
    }
  };

  requestAnimationFrame(frame);
}

function consider(container: HTMLElement) {
  if (handled.has(container)) {
    return;
  }
  if (performance.now() - intentAt > INTENT_MS) {
    return;
  }
  const text = container.querySelector<HTMLElement>('.module-message__text');
  const bubble = text?.parentElement;
  if (!bubble) {
    return;
  }
  // the direction class is not on the DOM; the app aligns your own bubbles to the end of the column
  if (getComputedStyle(bubble).alignSelf !== 'flex-end') {
    return;
  }
  handled.add(container);
  intentAt = 0; // one animation per send
  fly(container, bubble);
}

function scan(node: Node) {
  if (!(node instanceof HTMLElement)) {
    return;
  }
  const own = node.closest<HTMLElement>('[data-testid="message-container"]');
  if (own) {
    consider(own);
    return;
  }
  node.querySelectorAll<HTMLElement>('[data-testid="message-container"]').forEach(consider);
}

export function startSendMotion() {
  if (prefersReducedMotion()) {
    return;
  }

  document.addEventListener(
    'keydown',
    e => {
      const target = e.target as HTMLElement | null;
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !e.isComposing &&
        target?.closest?.('[data-testid="message-input-text-area"]')
      ) {
        markIntent();
      }
    },
    true
  );
  document.addEventListener(
    'pointerdown',
    e => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-testid="send-message-button"]')) {
        markIntent();
      }
    },
    true
  );

  new MutationObserver(mutations => {
    if (!intentAt) {
      return;
    }
    for (const m of mutations) {
      m.addedNodes.forEach(scan);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
