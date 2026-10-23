// Send progress and errors to the server (data/client.jsonl) – the phone has no console we can see.
// Only on the dev server (Tailscale) and locally; the public version sends nothing, and in the app
// build (__DEV_TOOLS__ = false) the code is not even included.

/** Is the app running from the dev server? (localhost or a Tailscale address, 100.64.0.0/10) */
export const isDevHost =
  __DEV_TOOLS__ && /^(localhost|127\.0\.0\.1|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/.test(globalThis.location?.hostname ?? '');

export function remoteLog(kind: string, data: Record<string, unknown> = {}) {
  if (!__DEV_TOOLS__ || !isDevHost) return;
  const body = JSON.stringify({ kind, at: new Date().toISOString(), ...data });
  try {
    // sendBeacon survives the page going to the background or closing.
    if (navigator.sendBeacon?.('api/log', new Blob([body], { type: 'application/json' }))) return;
    fetch('api/log', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
  } catch {
    /* logging must never stop the app */
  }
}

export function installErrorReporting() {
  addEventListener('error', e => remoteLog('error', { msg: e.message, src: e.filename, line: e.lineno, col: e.colno }));
  addEventListener('unhandledrejection', e => remoteLog('rejection', { msg: String(e.reason?.stack ?? e.reason) }));
  document.addEventListener('visibilitychange', () => remoteLog('visibility', { state: document.visibilityState }));
}
