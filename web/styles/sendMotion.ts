/**
 * iMessage-style "send" motion (visual only).
 *
 * What iMessage does, and what this reproduces:
 *  1. the new bubble starts exactly where the composer is, with the composer's size, and travels up
 *     to its place in the thread while it narrows to fit its text (a spring with a small overshoot);
 *  2. at the same time the messages that were already on screen glide up to make room, instead of
 *     jumping.
 *
 * Nothing about sending is touched: the app renders its own bubble as usual; this only hides that
 * bubble for the duration of the motion and animates a visual copy of it.
 *
 * Details
 *  - A send "intent" is recorded on Enter (without Shift) in the composer or a press on the send
 *    button. At that moment (before the app clears the field) the composer rect and the on-screen
 *    message rows are measured. Only a bubble added within INTENT_MS of an intent is animated, so
 *    history, received messages and conversation switches never animate.
 *  - The copy is a fixed-position clone, because the message list is a scroll container that would
 *    clip a bubble travelling in from the composer.
 *  - Targets are re-measured every frame, so a scroll-to-bottom that happens during the motion does
 *    not make anything land in the wrong place.
 */

const INTENT_MS = 1500;
const DURATION_MS = 560;
/** a bubble taller than this is multi-line: it can't narrow without re-wrapping, so it only moves */
const SINGLE_LINE_MAX_HEIGHT = 56;

type Intent = {
  at: number;
  composer: DOMRect | null;
  rows: Map<HTMLElement, number>;
};

let intent: Intent | null = null;
const handled = new WeakSet<Element>();

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** ease-out with a small overshoot, like an iOS spring that settles quickly */
function spring(t: number, overshoot = 1.0) {
  const c3 = overshoot + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + overshoot * x * x;
}

function markIntent() {
  const editor = document.querySelector<HTMLElement>('[data-testid="message-input-text-area"]');
  const composer = editor?.parentElement?.getBoundingClientRect() ?? null;

  const rows = new Map<HTMLElement, number>();
  document.querySelectorAll<HTMLElement>('[data-testid="message-container"]').forEach(row => {
    const r = row.getBoundingClientRect();
    if (r.bottom > 0 && r.top < window.innerHeight && rows.size < 40) {
      rows.set(row, r.top);
    }
  });

  intent = { at: performance.now(), composer, rows };
}

function animate(container: HTMLElement, bubble: HTMLElement, it: Intent) {
  const size = { width: bubble.offsetWidth, height: bubble.offsetHeight };
  if (!size.width || !size.height) {
    return;
  }

  const singleLine = size.height <= SINGLE_LINE_MAX_HEIGHT;
  const from = it.composer;
  const first = bubble.getBoundingClientRect();

  // start box: the composer itself (single line) or a small box at the composer (multi-line)
  let start: { left: number; top: number; width: number; height: number };
  if (!from) {
    start = { left: first.left, top: first.top + 60, width: size.width, height: size.height };
  } else if (singleLine) {
    // composer width, bubble height, vertically centered on the composer
    start = {
      left: from.left,
      top: from.top + from.height / 2 - size.height / 2,
      width: from.width,
      height: size.height,
    };
  } else {
    start = {
      left: from.left,
      top: from.top + from.height / 2 - size.height / 2,
      width: size.width,
      height: size.height,
    };
  }
  const startScale = singleLine ? 1 : 0.6;

  const ghost = bubble.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  if (singleLine) {
    // keep the text on one line while the bubble narrows (see liquid-glass.scss)
    ghost.setAttribute('data-lg-ghost', 'nowrap');
  }
  Object.assign(ghost.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    margin: '0',
    boxSizing: 'border-box',
    maxWidth: 'none',
    overflow: 'hidden',
    whiteSpace: singleLine ? 'nowrap' : '',
    zIndex: '2147483000',
    pointerEvents: 'none',
    transformOrigin: 'center center',
    willChange: 'transform, opacity',
    opacity: '0',
  });

  container.setAttribute('data-lg-sent', 'flying');
  document.body.appendChild(ghost);

  const applied = new Map<HTMLElement, number>();
  const begin = performance.now();

  const clearRows = () => {
    it.rows.forEach((_, row) => {
      row.style.translate = '';
    });
  };

  const frame = (now: number) => {
    if (!container.isConnected || !bubble.isConnected) {
      ghost.remove();
      clearRows();
      return;
    }
    const t = Math.min(1, (now - begin) / DURATION_MS);
    const e = spring(t);

    // ---- reads ----
    const live = bubble.getBoundingClientRect();
    const rowReads: Array<[HTMLElement, number]> = [];
    it.rows.forEach((before, row) => {
      if (row === container || !row.isConnected) {
        return;
      }
      const layoutTop = row.getBoundingClientRect().top - (applied.get(row) ?? 0);
      rowReads.push([row, (before - layoutTop) * (1 - e)]);
    });

    // ---- writes ----
    // never narrower than the final bubble: the spring may overshoot, the text must not be clipped
    const w = Math.max(size.width, lerp(start.width, size.width, e));
    const h = lerp(start.height, size.height, e);
    const cx = lerp(start.left + start.width / 2, live.left + live.width / 2, e);
    const cy = lerp(start.top + start.height / 2, live.top + live.height / 2, e);
    const s = lerp(startScale, 1, e);
    ghost.style.width = `${w}px`;
    ghost.style.height = `${h}px`;
    ghost.style.transform = `translate3d(${cx - w / 2}px, ${cy - h / 2}px, 0) scale(${s})`;
    ghost.style.opacity = String(Math.min(1, t / 0.12));

    rowReads.forEach(([row, ty]) => {
      applied.set(row, ty);
      row.style.translate = `0 ${ty}px`;
    });

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      ghost.remove();
      container.setAttribute('data-lg-sent', 'done');
      clearRows();
    }
  };

  requestAnimationFrame(frame);
}

function consider(container: HTMLElement) {
  if (handled.has(container) || !intent) {
    return;
  }
  if (performance.now() - intent.at > INTENT_MS) {
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
  const it = intent;
  intent = null; // one animation per send
  animate(container, bubble, it);
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
    if (!intent) {
      return;
    }
    for (const m of mutations) {
      m.addedNodes.forEach(scan);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
