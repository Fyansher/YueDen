/* Shared modal ownership: opening order controls layering, interaction and focus.
   Consumers keep their existing close/cancellation callbacks; Escape invokes the
   same close button as a pointer click. No player/data/network behavior lives here. */
(() => {
  const stack = [], blocked = new Map();
  const selector = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]';
  const top = () => stack.at(-1);
  const usable = node => node instanceof HTMLElement && node.isConnected && !node.closest('[inert]') && !node.matches(':disabled') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const controls = entry => [...entry.host.querySelectorAll(selector)].filter(node => node.tabIndex >= 0 && usable(node));
  function focus(entry, preferred) {
    if (!entry) return;
    const target = preferred && entry.host.contains(preferred) && usable(preferred) ? preferred : controls(entry)[0] || entry.panel;
    target.focus({ preventScroll: true });
  }
  function restoreBlocked() {
    for (const [node, inert] of blocked) node.inert = inert;
    blocked.clear();
  }
  function sync() {
    restoreBlocked();
    stack.forEach((entry, level) => {
      entry.host.style.setProperty('--app-modal-level', level);
      entry.panel.setAttribute('aria-modal', entry === top() ? 'true' : 'false');
    });
    const current = top();
    if (!current) return;
    // Block siblings at each ancestor, never the ancestor of the active modal.
    // This also supports a dialog mounted within the fullscreen element.
    for (let branch = current.host; branch && branch !== document.body; branch = branch.parentElement) {
      for (const sibling of branch.parentElement?.children || []) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        blocked.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    }
  }
  function release(host) {
    const index = stack.findIndex(entry => entry.host === host);
    if (index < 0) return;
    const wasTop = stack[index] === top(), [entry] = stack.splice(index, 1);
    host.removeAttribute('data-app-modal');
    host.style.removeProperty('--app-modal-level');
    entry.panel.removeAttribute('aria-modal');
    sync();
    if (!wasTop) return;
    if (top()) focus(top(), entry.opener || top().lastFocus);
    else if (usable(entry.opener)) entry.opener.focus({ preventScroll: true });
  }
  function open(host, onEscape) {
    if (stack.some(entry => entry.host === host)) return host;
    const opener = document.activeElement;
    if (!host.isConnected) (document.fullscreenElement || document.body).append(host);
    const panel = host.querySelector('[role=dialog],section') || host;
    panel.setAttribute('role', 'dialog');
    if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
    const entry = {host, panel, opener, onEscape, lastFocus: null};
    host.setAttribute('data-app-modal', '');
    stack.push(entry);
    sync();
    focus(entry);
    // Factories fill their body synchronously after opening; focus the first field
    // once that construction is complete, without polling or arbitrary delays.
    queueMicrotask(() => {
      if (top() !== entry || !host.isConnected) return;
      const input = [...host.querySelectorAll('[autofocus],input,textarea,select')].find(usable);
      focus(entry, input);
    });
    return host;
  }
  function remove(host) {
    if (!host) return;
    host.remove();
    release(host);
  }
  window.addEventListener('keydown', event => {
    const current = top();
    if (!current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) current.onEscape();
    } else if (event.key === 'Tab') {
      const list = controls(current), index = list.indexOf(document.activeElement);
      event.preventDefault();
      event.stopImmediatePropagation();
      focus(current, list.length ? list[(index + (event.shiftKey ? -1 : 1) + list.length) % list.length] : current.panel);
    }
  }, true);
  window.addEventListener('focusin', event => {
    const current = top();
    if (!current) return;
    if (current.host.contains(event.target)) current.lastFocus = event.target;
    else { event.stopImmediatePropagation(); focus(current, current.lastFocus); }
  }, true);
  for (const type of ['pointerdown', 'click', 'contextmenu']) window.addEventListener(type, event => {
    const current = top();
    if (current && !current.host.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  new MutationObserver(() => {
    for (const entry of [...stack].reverse()) if (!entry.host.isConnected || entry.host.hidden || entry.host.classList.contains('hidden')) release(entry.host);
    sync();
  }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden']});
  window.appModalStack = {open, remove, release};
})();