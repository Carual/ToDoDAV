import { Platform } from 'react-native';

// The browser's Back and Forward don't reach the navigator's usePreventRemove (the router just resets to the new
// URL), and a popstate can't be cancelled or wait for an in-app dialog. So a listener registered before the router's
// (this module is loaded ahead of it, from index.ts) keeps a guarded move from the router, undoes it at once with
// history.go(), and replays it if the user agrees to leave. Undoing needs to know how far the move went, so every
// history entry records its position next to the router's own state (React Navigation only reads its `id`).

/**
 * Called when Back or Forward is pressed. A promise keeps the move from the router until it settles, and replays it
 * on true; undefined lets it through (nothing to ask, or the page is leaving on purpose).
 */
type Guard = () => Promise<boolean> | undefined;

let current: Guard | null = null;

/** Sets the guard; the returned function removes it, unless another guard has replaced it since. */
export function setLeaveGuard(guard: Guard): () => void {
  current = guard;
  return () => {
    if (current === guard) current = null;
  };
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  const { history } = window;
  const indexOf = (state: unknown) => {
    const index = (state as { tododavIndex?: unknown } | null)?.tododavIndex;
    return typeof index === 'number' ? index : 0;
  };

  let currentIndex = indexOf(history.state);
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  const withIndex = (state: unknown) => ({ ...(state as object | null), tododavIndex: currentIndex });
  history.pushState = (state, unused, url) => {
    currentIndex += 1;
    push(withIndex(state), unused, url);
  };
  history.replaceState = (state, unused, url) => replace(withIndex(state), unused, url);
  replace(withIndex(history.state), '');

  /** Our own history.go() is undoing a guarded move: its popstate is nobody else's business. */
  let undoing = false;
  /** The guard is asking; more Back/Forward presses are just undone meanwhile. */
  let asking = false;

  window.addEventListener('popstate', (event) => {
    if (undoing) {
      undoing = false;
      event.stopImmediatePropagation();
      return;
    }
    const index = indexOf(event.state);
    const delta = index - currentIndex;
    const answer = asking || delta === 0 ? undefined : current?.();
    if (!asking && !answer) {
      currentIndex = index;
      return;
    }
    event.stopImmediatePropagation();
    undoing = true;
    history.go(-delta);
    if (!answer) return;
    asking = true;
    void answer.then((leave) => {
      asking = false;
      // The guard has let go by now (the page is leaving on purpose), so the replay reaches the router.
      if (leave) history.go(delta);
    });
  });
}
