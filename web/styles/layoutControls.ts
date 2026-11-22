/**
 * Small UI controls that go with layout.scss (visual navigation only, no app logic):
 *
 *  - a handle on the edge of the sidebar that collapses / expands the conversation list
 *    (remembered in localStorage, Ctrl/Cmd + \ as a shortcut), desktop and tablet only
 *  - on the phone layout (one pane at a time), a back button in the chat header that returns to the
 *    conversation list, also bound to the browser / Android back button
 *
 * "Back" dispatches the action the app already has for closing the open conversation
 * (`conversations/resetConversationExternal`), so the list is simply shown again. It is dispatched by
 * its type string rather than imported: importing the app's state modules here would run them
 * before the app has set up its logger.
 */

const STORAGE_KEY = 'lg:sidebar';
const PHONE_QUERY = '(max-width: 700px)';

const CHEVRON_LEFT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'collapsed';
  } catch (e) {
    return false;
  }
}

function setCollapsed(collapsed: boolean) {
  document.documentElement.dataset.lgSidebar = collapsed ? 'collapsed' : 'open';
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'open');
  } catch (e) {
    /* storage can be unavailable (private mode): the toggle still works for this visit */
  }
  const button = document.querySelector<HTMLButtonElement>('.lg-sidebar-toggle');
  if (button) {
    const label = collapsed ? 'Show conversations' : 'Hide conversations';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = `${label} (Ctrl/⌘ + \\)`;
  }
}

function toggleSidebar() {
  setCollapsed(document.documentElement.dataset.lgSidebar !== 'collapsed');
}

function ensureSidebarToggle() {
  if (document.querySelector('.lg-sidebar-toggle')) {
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lg-sidebar-toggle';
  button.innerHTML = CHEVRON_LEFT;
  button.addEventListener('click', toggleSidebar);
  document.body.appendChild(button);
  setCollapsed(readCollapsed());
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
    ensureSidebarToggle();

    new MutationObserver(() => {
      ensureSidebarToggle();
      ensureBackButton();
      syncChatHistory();
    }).observe(document.body, { childList: true, subtree: true });
  };

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

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
