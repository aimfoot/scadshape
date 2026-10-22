// Skicka förlopp och fel till servern (data/client.jsonl) – telefonen har ingen konsol vi ser.
// Bara på utvecklingsservern (Tailscale) och lokalt; den publika versionen skickar ingenting, och i
// appbygget (__DEV_TOOLS__ = false) finns koden inte ens med.

/** Körs appen från utvecklingsservern? (localhost eller en Tailscale-adress, 100.64.0.0/10) */
export const isDevHost =
  __DEV_TOOLS__ && /^(localhost|127\.0\.0\.1|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/.test(globalThis.location?.hostname ?? '');

export function remoteLog(kind: string, data: Record<string, unknown> = {}) {
  if (!__DEV_TOOLS__ || !isDevHost) return;
  const body = JSON.stringify({ kind, at: new Date().toISOString(), ...data });
  try {
    // sendBeacon överlever att sidan läggs i bakgrunden eller stängs.
    if (navigator.sendBeacon?.('api/log', new Blob([body], { type: 'application/json' }))) return;
    fetch('api/log', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
  } catch {
    /* loggning får aldrig stoppa appen */
  }
}

export function installErrorReporting() {
  addEventListener('error', e => remoteLog('error', { msg: e.message, src: e.filename, line: e.lineno, col: e.colno }));
  addEventListener('unhandledrejection', e => remoteLog('rejection', { msg: String(e.reason?.stack ?? e.reason) }));
  document.addEventListener('visibilitychange', () => remoteLog('visibility', { state: document.visibilityState }));
}
