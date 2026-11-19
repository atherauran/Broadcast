import { useSyncExternalStore } from 'react';

// The page's idea of "now", kept outside React state so a tick re-renders only the components that read it.
// It follows server time, so a teacher's wrong laptop clock never shows wrong countdowns or online status.
let base = { server: Date.now(), local: performance.now() };
let current = base.server;
let period = 5000;
let timer: number | undefined;
const listeners = new Set<() => void>();

export const serverNow = () => base.server + performance.now() - base.local;

function emit(value: number) { current = value; listeners.forEach(listener => listener()); }
function start() {
  clearInterval(timer);
  timer = window.setInterval(() => { if (!document.hidden) emit(serverNow()); }, period);
}

/** Calibrate to the server's time from a response. */
export function syncClock(server: string) {
  base = { server: Date.parse(server), local: performance.now() };
  emit(base.server);
}
/** Only the on-screen tab shows a countdown, so only it needs a per-second tick. */
export function setTickRate(ms: number) { period = ms; if (listeners.size) start(); }

function subscribe(listener: () => void) {
  if (!listeners.size) { current = serverNow(); start(); }
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) clearInterval(timer); };
}
export const useNow = () => useSyncExternalStore(subscribe, () => current);
