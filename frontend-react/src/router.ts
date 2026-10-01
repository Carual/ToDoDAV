import { useEffect, useSyncExternalStore } from 'react';

// A few routes do not justify a router dependency: the History API and a couple of hooks are enough.
// Deep links need the server to answer every app path with index.html (Vite does it in dev;
// in production the reverse proxy must, see README).

export type Route =
  | { name: 'login' }
  | { name: 'tasks'; uid?: string }
  | { name: 'journal'; uid?: string }
  | { name: 'unknown' };

/** pushState does not fire popstate, so the router announces every accepted change with this event. */
const NAVIGATE_EVENT = 'tododav:navigate';

// popstate fires after the URL already changed and cannot be cancelled, or wait for an in-app
// dialog. So a guarded Back/Forward is undone at once with history.go() (each entry records its
// position, so it works whichever way the move went), and replayed if the user agrees to leave.
// The app's path only changes once a move is accepted, so nothing renders the page being left.
function entryIndex(state: unknown): number {
  const index = (state as { index?: unknown } | null)?.index;
  return typeof index === 'number' ? index : 0;
}

let currentIndex = entryIndex(window.history.state);
let currentPath = window.location.pathname;
window.history.replaceState({ index: currentIndex }, '');

/** Asked before Back/Forward leaves the current page; resolving false keeps the user where they are. */
let leaveGuard: (() => Promise<boolean>) | null = null;
/** The guard is showing its question; more Back/Forward presses are just undone meanwhile. */
let asking = false;
/** The next move is the replay of one the user already agreed to. */
let leaveAgreed = false;

function onPopState(event: PopStateEvent) {
  const index = entryIndex(event.state);
  if (index === currentIndex) return; // our own history.go() undoing a guarded move
  if (leaveGuard && !leaveAgreed) {
    const delta = index - currentIndex;
    window.history.go(-delta);
    if (asking) return;
    asking = true;
    void leaveGuard().then((leave) => {
      asking = false;
      if (!leave) return;
      leaveAgreed = true;
      window.history.go(delta);
    });
    return;
  }
  leaveAgreed = false;
  currentIndex = index;
  currentPath = window.location.pathname;
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

window.addEventListener('popstate', onPopState);
// In dev, an edit here re-runs this module; the old listener would keep acting on its stale state.
import.meta.hot?.dispose(() => window.removeEventListener('popstate', onPopState));

function subscribe(onChange: () => void) {
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => window.removeEventListener(NAVIGATE_EVENT, onChange);
}

/** The current path; re-renders on navigate() and on the browser's back/forward buttons. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => currentPath);
}

/** The app's own moves skip the leave guard: callers decide first (e.g. the modal's discard prompt). */
export function navigate(path: string, { replace = false } = {}) {
  if (path === currentPath) return;
  if (replace) {
    window.history.replaceState({ index: currentIndex }, '', path);
  } else {
    currentIndex += 1;
    window.history.pushState({ index: currentIndex }, '', path);
  }
  currentPath = window.location.pathname; // as the browser normalized it
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/**
 * While `active`, Back/Forward calls `ask` (e.g. to show a dialog) and only leaves if it resolves true.
 * Reloading or closing the tab gets the browser's own "leave site?" prompt instead: pages cannot
 * replace or restyle that one.
 */
export function useLeaveGuard(active: boolean, ask: () => Promise<boolean>) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ''; // older browsers only prompt when this is set
    };
    leaveGuard = ask;
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      if (leaveGuard === ask) leaveGuard = null;
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [active, ask]);
}

export function parseRoute(path: string): Route {
  if (/^\/login\/?$/.test(path)) return { name: 'login' };
  const match = /^\/(tasks|journal)(?:\/([^/]+))?\/?$/.exec(path);
  if (!match) return { name: 'unknown' };
  const name = match[1] as 'tasks' | 'journal';
  const encodedUid = match[2];
  if (!encodedUid) return { name };
  try {
    return { name, uid: decodeURIComponent(encodedUid) };
  } catch {
    return { name: 'unknown' }; // malformed percent-encoding
  }
}

/** UIDs are free text (often `something@host`), so they are always encoded into the path. */
export function taskPath(uid: string): string {
  return `/tasks/${encodeURIComponent(uid)}`;
}

export function journalPath(uid: string): string {
  return `/journal/${encodeURIComponent(uid)}`;
}
