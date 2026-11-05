/**
 * Capacitor Android Chat keyboard adaptation.
 *
 * The window and visual viewport can resize at different times on Gboard.
 * Measure the visible bottom AFTER resize events, rather than relying only
 * on 100dvh. The fixed bottom navigation hides while the keyboard is open,
 * and Chat is constrained to the space above the keyboard.
 */
export function computeNativeChatHeight({
  visibleHeight, visibleTop = 0, mainTop = 0, bottomNavigationHeight = 0,
  keyboardOpen = false
}) {
  const bottom = Math.max(0, Number(visibleHeight) + Number(visibleTop));
  const top = Math.max(0, Number(mainTop) || 0);
  const nav = keyboardOpen ? 0 : Math.max(0, Number(bottomNavigationHeight) || 0);
  return Math.max(100, Math.floor(bottom - top - nav - 8));
}

export function createAndroidChatKeyboard({
  windowObject, documentObject, input, messages, main,
  keyboardThreshold = 110
}) {
  const win = windowObject;
  const doc = documentObject;
  const body = doc.body;
  const root = doc.documentElement;
  if (!win || !doc || !input || !messages || !main || !body) {
    return { sync() {}, scrollLatest() {}, dispose() {} };
  }

  const viewport = win.visualViewport;
  const nav = doc.querySelector('.app-bottom-nav');
  const composer = doc.querySelector('.chat-composer');
  const timers = new Set();
  let frame = null;
  let disposed = false;
  let keyboardIsOpen = false;
  const viewportHeight = () => Math.max(0, Number(viewport?.height || win.innerHeight || 0));
  let baselineHeight = viewportHeight();

  function activeChat() {
    return body.dataset.appView === 'chat' && !body.classList.contains('auth-required');
  }

  function scrollLatest() {
    if (disposed || !activeChat()) return;
    if (frame != null) win.cancelAnimationFrame?.(frame);
    frame = win.requestAnimationFrame(() => {
      frame = null;
      messages.scrollTop = messages.scrollHeight;
    });
  }

  function sync() {
    if (disposed) return;
    const height = viewportHeight();
    const focus = doc.activeElement === input;
    if (!focus) baselineHeight = height;
    const open = activeChat() && focus && baselineHeight - height >= keyboardThreshold;
    if (open) {
      const size = computeNativeChatHeight({
        visibleHeight:height,
        visibleTop:viewport?.offsetTop || 0,
        mainTop:main.getBoundingClientRect().top,
        keyboardOpen:true
      });
      main.style.setProperty('--mss-native-chat-height', size + 'px');
      body.dataset.mssNativeKeyboard = 'open';
    } else {
      main.style.removeProperty('--mss-native-chat-height');
      delete body.dataset.mssNativeKeyboard;
    }
    const changed = open !== keyboardIsOpen;
    keyboardIsOpen = open;
    if ((open || changed) && activeChat()) scrollLatest();
  }

  function scheduleAfterKeyboardAnimation() {
    sync();
    // Gboard and other Android IMEs animate the keyboard over several frames.
    // Keep the newest robot response above the keyboard after the last resize.
    for (const delay of [70, 240, 480]) {
      const token = win.setTimeout(() => {
        timers.delete(token);
        sync();
        if (activeChat()) scrollLatest();
      }, delay);
      timers.add(token);
    }
  }

  function onFocus() {
    scheduleAfterKeyboardAnimation();
  }
  function onBlur() {
    sync();
    scheduleAfterKeyboardAnimation();
  }
  function onResize() {
    sync();
    if (activeChat() && doc.activeElement === input) scrollLatest();
  }

  input.addEventListener('focus', onFocus);
  input.addEventListener('blur', onBlur);
  win.addEventListener('resize', onResize, {passive:true});
  viewport?.addEventListener('resize', onResize, {passive:true});
  viewport?.addEventListener('scroll', onResize, {passive:true});
  const observer = typeof win.ResizeObserver === 'function' && composer
    ? new win.ResizeObserver(onResize) : null;
  observer?.observe(composer);

  sync();
  return {
    sync,
    scrollLatest,
    isKeyboardOpen:() => keyboardIsOpen,
    dispose() {
      disposed = true;
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('blur', onBlur);
      win.removeEventListener('resize', onResize);
      viewport?.removeEventListener('resize', onResize);
      viewport?.removeEventListener('scroll', onResize);
      observer?.disconnect();
      if (frame != null) win.cancelAnimationFrame?.(frame);
      for (const token of timers) win.clearTimeout(token);
      timers.clear();
      main.style.removeProperty('--mss-native-chat-height');
      delete body.dataset.mssNativeKeyboard;
    }
  };
}
