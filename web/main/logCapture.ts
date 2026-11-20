/**
 * Keeps the last log lines in memory so that Settings > Help > "Export Logs" (which does nothing in
 * a browser by default) can download them as a text file.
 *
 * Only what the app already prints to the console is kept. The log lines of the app redact most
 * identifiers, but the file is meant to be read by the person helping you: look through it before
 * sharing it.
 */
const MAX_LINES = 6000;
const lines: Array<string> = [];

const format = (args: Array<unknown>) =>
  args
    .map(a => {
      if (typeof a === 'string') {
        return a;
      }
      if (a instanceof Error) {
        return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
      }
      try {
        return JSON.stringify(a);
      } catch (e) {
        return String(a);
      }
    })
    .join(' ');

export function startLogCapture() {
  (['log', 'info', 'warn', 'error', 'debug'] as const).forEach(level => {
    const original = console[level].bind(console);
    console[level] = (...args: Array<unknown>) => {
      lines.push(`${new Date().toISOString()} [${level}] ${format(args)}`);
      if (lines.length > MAX_LINES) {
        lines.splice(0, lines.length - MAX_LINES);
      }
      original(...args);
    };
  });
  window.addEventListener('error', e => lines.push(`${new Date().toISOString()} [window.error] ${e.message}`));
  window.addEventListener('unhandledrejection', e =>
    lines.push(`${new Date().toISOString()} [unhandledrejection] ${format([e.reason])}`)
  );
}

export function downloadLogs() {
  const header = [
    `Session Web log export, ${new Date().toISOString()}`,
    `userAgent: ${navigator.userAgent}`,
    `online: ${navigator.onLine}`,
    `lines: ${lines.length}`,
    '',
  ].join('\n');
  const blob = new Blob([header, lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `session-web-log-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
