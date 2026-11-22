/**
 * Show the green "send" button as soon as there is text in the composer, also while a Korean /
 * Japanese / Chinese IME is still composing the first character (visual only).
 *
 * Why this is needed: while an IME composes, the app's input component ignores `input` events on
 * purpose (CompositionInput.tsx: `if (isComposing.current) return`), because rewriting the field
 * during a composition would cancel it. So the app learns about the text only when the syllable is
 * committed, and until then it keeps showing the microphone button: typing "ㅎ" or "하" does not show
 * the send button, while typing "a" does.
 *
 * What this does, without touching the input component:
 *  - watches the field, and when it holds visible text, marks the composer (`data-lg-typing`);
 *    layout CSS then draws the microphone button as the green send button
 *  - when that look-alike is clicked, the click is taken over: the field is blurred (which makes the
 *    IME commit its composition), the app then renders its real send button, and that one is
 *    clicked. (If the committed text turns out empty nothing is sent.)
 */

const EDITOR = '[data-testid="message-input-text-area"]';
const MIC = '[data-testid="microphone-button"]';
const SEND = '[data-testid="send-message-button"]';

/** the element the layout CSS keys on: the row holding the field and the right-hand buttons */
function composerBox(editor: Element): HTMLElement | null {
  return editor.parentElement?.parentElement ?? null;
}

function hasVisibleText(editor: Element): boolean {
  // the field keeps zero-width characters around mentions / for the caret
  return (editor.textContent ?? '').replace(/[​﻿]/g, '').trim().length > 0;
}

function syncTypingState() {
  const editor = document.querySelector(EDITOR);
  const box = editor ? composerBox(editor) : null;
  if (!editor || !box) {
    return;
  }
  const typing = hasVisibleText(editor);
  if (typing !== box.hasAttribute('data-lg-typing')) {
    if (typing) {
      box.setAttribute('data-lg-typing', '');
    } else {
      box.removeAttribute('data-lg-typing');
    }
  }
}

function waitFor<T extends Element>(selector: string, timeoutMs: number): Promise<T | null> {
  return new Promise(resolve => {
    const started = performance.now();
    const tick = () => {
      const found = document.querySelector<T>(selector);
      if (found) {
        resolve(found);
      } else if (performance.now() - started > timeoutMs) {
        resolve(null);
      } else {
        requestAnimationFrame(tick);
      }
    };
    tick();
  });
}

async function commitAndSend() {
  // the app re-renders the right-hand buttons once the committed text reaches its state
  const send = await waitFor<HTMLButtonElement>(SEND, 800);
  if (send) {
    // lets the send motion (sendMotion.ts) see this as a send, as it would for a real press
    send.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    send.click();
  }
  window.setTimeout(() => document.querySelector<HTMLElement>(EDITOR)?.focus(), 0);
}

export function startComposerSend() {
  const isInEditor = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest(EDITOR);

  for (const type of ['input', 'compositionstart', 'compositionupdate', 'compositionend', 'keyup']) {
    document.addEventListener(
      type,
      e => {
        if (isInEditor(e.target)) {
          syncTypingState();
        }
      },
      true
    );
  }

  // text can also change without an input event (sent, draft restored, conversation switched)
  new MutationObserver(syncTypingState).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  /** the microphone button while it is dressed as the send button */
  const fakeSend = (target: EventTarget | null) => {
    const mic = target instanceof Element ? target.closest(MIC) : null;
    return mic && mic.closest('[data-lg-typing]') ? mic : null;
  };

  // Pressing a button normally moves focus out of the field, which makes the IME commit its text and
  // the app swap the microphone button for the real send button *under the pointer*, so the click
  // would land on nothing. Keep the focus in the field while the button is held; the commit is done
  // explicitly on click instead.
  document.addEventListener(
    'mousedown',
    e => {
      if (fakeSend(e.target)) {
        e.preventDefault();
      }
    },
    true
  );

  document.addEventListener(
    'click',
    e => {
      if (!fakeSend(e.target)) {
        return;
      }
      // the mic button is showing as "send": do not start a voice recording
      e.preventDefault();
      e.stopImmediatePropagation();
      // leaving the field commits the IME composition, which lets the app see the text
      document.querySelector<HTMLElement>(EDITOR)?.blur();
      void commitAndSend();
    },
    true
  );
}
