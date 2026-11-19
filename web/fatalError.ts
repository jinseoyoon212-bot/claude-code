export function showFatalError(e: unknown) {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }
  const box = document.createElement('pre');
  box.style.cssText =
    'color:#fff;background:#1b1b1b;padding:16px;margin:16px;white-space:pre-wrap;font:13px monospace;';
  box.textContent = `Session Web failed to start:\n\n${(e as any)?.stack || String(e)}`;
  root.replaceChildren(box);
}
