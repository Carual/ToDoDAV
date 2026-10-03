import { Platform } from 'react-native';

// The browser's Back and Forward don't reach the navigator's usePreventRemove (the router just resets to the new
// URL), and a popstate can't be cancelled. So a listener registered before the router's (this module is loaded
// ahead of it, from index.ts) can keep the router from seeing the move, for a screen that set a guard.

/** Called first when Back or Forward is pressed; returning true keeps the move from the router. */
type Guard = () => boolean;

let current: Guard | null = null;

export function setLeaveGuard(guard: Guard | null) {
  current = guard;
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('popstate', (event) => {
    if (current?.()) event.stopImmediatePropagation();
  });
}
