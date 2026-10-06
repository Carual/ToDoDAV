import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { CalDavError, type Calendar } from '../api/caldav.ts';
import { logIn, type Session } from '../api/connect.ts';
import { readLogin, writeLogin, type StoredLogin } from './loginStore.ts';
// No extension: the bundler picks updateWidgets.android.ts on Android; elsewhere it does nothing.
import { updateWidgets } from '../widget/updateWidgets';

interface SessionContextValue {
  session: Session | null;
  /** True while the saved login is being tried at startup. */
  restoring: boolean;
  /** Why the saved login didn't work at startup, for the login screen. */
  restoreError: string | null;
  signIn: (session: Session, login: StoredLogin) => void;
  signOut: () => void;
  setCalendars: (calendars: Calendar[]) => void;
  setJournals: (journals: Calendar[]) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Log in again silently with the saved login (after a reload on the web, at every start on Android/iOS).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const login = await readLogin();
      if (!login) return;
      try {
        const restored = await logIn(login, login.transport);
        if (!cancelled) setSession(restored);
      } catch (error) {
        // Only a refused password makes the saved login useless; when the server can't be reached it is kept for
        // the next start.
        if (error instanceof CalDavError && error.status === 401) await writeLogin(null);
        if (!cancelled) setRestoreError(error instanceof Error ? error.message : 'Could not log in.');
      }
    })().finally(() => {
      if (!cancelled) setRestoring(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The home-screen widget reads the server on its own: redraw it when leaving the app, so it shows what was done here.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') updateWidgets();
    });
    return () => subscription.remove();
  }, []);

  const signIn = useCallback((next: Session, login: StoredLogin) => {
    // The widget uses the saved login, so it is redrawn once that is written.
    void writeLogin(login).then(updateWidgets);
    setRestoreError(null);
    setSession(next);
  }, []);

  const signOut = useCallback(() => {
    void writeLogin(null).then(updateWidgets);
    setSession(null);
  }, []);

  const setCalendars = useCallback(
    (calendars: Calendar[]) => setSession((current) => current && { ...current, calendars }),
    [],
  );

  const setJournals = useCallback(
    (journals: Calendar[]) => setSession((current) => current && { ...current, journals }),
    [],
  );

  const value = useMemo(
    () => ({ session, restoring, restoreError, signIn, signOut, setCalendars, setJournals }),
    [session, restoring, restoreError, signIn, signOut, setCalendars, setJournals],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider.');
  return value;
}

/** The logged-in session, for screens that only exist while logged in. */
export function useLoggedIn(): Session & Pick<SessionContextValue, 'signOut' | 'setCalendars' | 'setJournals'> {
  const { session, signOut, setCalendars, setJournals } = useSession();
  if (!session) throw new Error('This screen needs a session.');
  return { ...session, signOut, setCalendars, setJournals };
}
