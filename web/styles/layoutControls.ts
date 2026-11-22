/**
 * Small UI controls that go with layout.scss (visual navigation only, no app logic):
 *
 *  - a resize bar between the conversation list and the chat (desktop and tablet): drag it to set
 *    the list width; drag it narrow enough and the list collapses to the icon rail, drag it back out
 *    to open it again. Double-click toggles, the arrow keys nudge it, Ctrl/Cmd + \ toggles from the
 *    keyboard. Width and collapsed state are remembered in localStorage.
 *  - on the phone layout (one pane at a time), a back button in the chat header that returns to the
 *    conversation list, also bound to the browser / Android back button
 *
 * "Back" dispatches the action the app already has for closing the open conversation
 * (`conversations/resetConversationExternal`), so the list is simply shown again. It is dispatched by
 * its type string rather than imported: importing the app's state modules here would run them
 * before the app has set up its logger.
 */

const STATE_KEY = 'lg:sidebar';
const WIDTH_KEY = 'lg:sidebar-width';
const PHONE_QUERY = '(max-width: 700px)';

const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 260;
/** dragging the bar to a list narrower than this collapses the list */
const COLLAPSE_BELOW = 190;
const KEY_STEP = 16;

const CHEVRON_LEFT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

const root = () => document.documentElement;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* storage can be unavailable (private mode): the bar still works for this visit */
  }
}

/** a px custom property of layout.scss, e.g. --lg-frame */
function px(name: string): number {
  return parseFloat(getComputedStyle(document.body).getPropertyValue(name)) || 0;
}

const maxWidth = () => Math.max(MIN_WIDTH, Math.min(560, Math.round(window.innerWidth * 0.5)));
const clampWidth = (w: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));

let listWidth = DEFAULT_WIDTH;

/**
 * The conversation list is a react-virtualized List inside an AutoSizer, which learns about size
 * changes from scroll events of two hidden "trigger" elements it puts in its parent. That detection
 * does not notice the column being resized by CSS here, so tell it: a bubbling scroll event from
 * each trigger makes it re-measure its parent (this is what the browser would send itself).
 */
function notifyListResize() {
  document.querySelectorAll('.resize-triggers > div').forEach(trigger => {
    trigger.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
}

/** after a CSS width transition (520ms) has finished, the list must measure the final width */
function notifyListResizeAfterTransition() {
  notifyListResize();
  window.setTimeout(notifyListResize, 600);
}

function applyWidth(width: number) {
  listWidth = clampWidth(width);
  root().style.setProperty('--lg-list', `${listWidth}px`);
}

function isCollapsed() {
  return root().dataset.lgSidebar === 'collapsed';
}

function syncResizer() {
  const bar = document.querySelector<HTMLElement>('.lg-resizer');
  if (!bar) {
    return;
  }
  const collapsed = isCollapsed();
  bar.setAttribute('aria-valuenow', String(collapsed ? 0 : listWidth));
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(maxWidth()));
  bar.title = collapsed
    ? 'Drag to show conversations (double-click, or Ctrl/⌘ + \\)'
    : 'Drag to resize, double-click to hide (Ctrl/⌘ + \\)';
}

function setCollapsed(collapsed: boolean, persist = true) {
  root().dataset.lgSidebar = collapsed ? 'collapsed' : 'open';
  if (persist) {
    writeStorage(STATE_KEY, collapsed ? 'collapsed' : 'open');
    writeStorage(WIDTH_KEY, String(listWidth));
    notifyListResizeAfterTransition();
  }
  syncResizer();
}

function toggleSidebar() {
  setCollapsed(!isCollapsed());
}

/** list width that puts the middle of the gap under the pointer at x */
function widthForPointer(x: number) {
  return x - px('--lg-frame') - px('--lg-rail') - px('--lg-gap') / 2;
}

function startDrag(e: PointerEvent, bar: HTMLElement) {
  if (e.button !== 0) {
    return;
  }
  e.preventDefault();
  bar.setPointerCapture(e.pointerId);
  root().classList.add('lg-resizing');

  let frameRequested = false;
  let lastX = e.clientX;

  const update = () => {
    frameRequested = false;
    const raw = widthForPointer(lastX);
    if (raw < COLLAPSE_BELOW) {
      if (!isCollapsed()) {
        setCollapsed(true, false);
      }
    } else {
      applyWidth(raw);
      if (isCollapsed()) {
        setCollapsed(false, false);
      }
    }
    notifyListResize();
  };

  const onMove = (ev: PointerEvent) => {
    lastX = ev.clientX;
    if (!frameRequested) {
      frameRequested = true;
      requestAnimationFrame(update);
    }
  };

  const onEnd = () => {
    bar.removeEventListener('pointermove', onMove);
    bar.removeEventListener('pointerup', onEnd);
    bar.removeEventListener('pointercancel', onEnd);
    root().classList.remove('lg-resizing');
    setCollapsed(isCollapsed()); // persist the final state and width
  };

  bar.addEventListener('pointermove', onMove);
  bar.addEventListener('pointerup', onEnd);
  bar.addEventListener('pointercancel', onEnd);
}

function ensureSidebarResizer() {
  if (document.querySelector('.lg-resizer')) {
    return;
  }
  const bar = document.createElement('div');
  bar.className = 'lg-resizer';
  bar.setAttribute('role', 'separator');
  bar.setAttribute('aria-orientation', 'vertical');
  bar.setAttribute('aria-label', 'Resize conversation list');
  bar.tabIndex = 0;
  bar.innerHTML = '<span class="lg-resizer-grip"></span>';

  bar.addEventListener('pointerdown', e => startDrag(e, bar));
  bar.addEventListener('dblclick', toggleSidebar);
  bar.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const grow = e.key === 'ArrowRight';
      if (isCollapsed()) {
        if (grow) {
          setCollapsed(false);
        }
        return;
      }
      const next = listWidth + (grow ? KEY_STEP : -KEY_STEP);
      if (next < MIN_WIDTH) {
        setCollapsed(true);
      } else {
        applyWidth(next);
        setCollapsed(false);
        notifyListResize();
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleSidebar();
    }
  });

  document.body.appendChild(bar);

  // restore what the user chose last time
  const saved = parseInt(readStorage(WIDTH_KEY) ?? '', 10);
  applyWidth(Number.isFinite(saved) ? saved : DEFAULT_WIDTH);
  setCollapsed(readStorage(STATE_KEY) === 'collapsed', false);
}

// ---- phone: back to the list ----

let chatWasOpen = false;

function closeChat() {
  window.inboxStore?.dispatch({ type: 'conversations/resetConversationExternal' });
}

function ensureBackButton() {
  const header = document.querySelector<HTMLElement>('.conversation-header');
  if (!header || header.querySelector('.lg-back')) {
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lg-back';
  button.setAttribute('aria-label', 'Back');
  button.innerHTML = CHEVRON_LEFT;
  button.addEventListener('click', e => {
    e.stopPropagation();
    if (window.history.state?.lgChat) {
      window.history.back(); // popstate closes the chat
    } else {
      closeChat();
    }
  });
  header.prepend(button);
}

function syncChatHistory() {
  const chatOpen = !!document.querySelector('.conversation-header');
  if (chatOpen && !chatWasOpen && isPhone()) {
    // one history entry per opened chat, so the system back gesture returns to the list
    window.history.pushState({ lgChat: true }, '');
  }
  chatWasOpen = chatOpen;
}

export function startLayoutControls() {
  const init = () => {
    ensureSidebarResizer();

    new MutationObserver(() => {
      ensureSidebarResizer();
      ensureBackButton();
      syncChatHistory();
    }).observe(document.body, { childList: true, subtree: true });
  };

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  window.addEventListener('resize', () => {
    if (!isCollapsed()) {
      applyWidth(listWidth);
    }
    syncResizer();
    notifyListResize();
  });

  window.addEventListener('popstate', () => {
    if (isPhone() && document.querySelector('.conversation-header')) {
      closeChat();
    }
  });

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      toggleSidebar();
    }
  });
}
