import { useCallback, useEffect, useState } from 'react';
import type { Credentials } from './api/caldav.ts';
import { logIn, Login, type Session } from './components/Login.tsx';
import { MainPage } from './components/MainPage.tsx';

// sessionStorage: survives a page reload but is gone when the tab closes (never localStorage).
const CREDENTIALS_KEY = 'tododav.credentials';

function readCredentials(): Credentials | null {
  try {
    const raw = sessionStorage.getItem(CREDENTIALS_KEY);
    return raw ? (JSON.parse(raw) as Credentials) : null;
  } catch {
    return null;
  }
}

function writeCredentials(credentials: Credentials | null) {
  try {
    if (credentials) sessionStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
    else sessionStorage.removeItem(CREDENTIALS_KEY);
  } catch {
    // Without storage the user simply logs in again after a reload.
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(() => readCredentials() !== null);

  // After a reload, log in again silently with the credentials kept for this tab.
  useEffect(() => {
    const credentials = readCredentials();
    if (!credentials) return;
    logIn(credentials)
      .then(setSession)
      .catch(() => writeCredentials(null))
      .finally(() => setRestoring(false));
  }, []);

  const logOut = useCallback(() => {
    writeCredentials(null);
    setSession(null);
  }, []);

  if (restoring) return <p className="splash muted">Loading…</p>;
  if (!session) {
    return (
      <Login
        onLogin={(next, credentials) => {
          writeCredentials(credentials);
          setSession(next);
        }}
      />
    );
  }
  return <MainPage session={session} onLogout={logOut} />;
}
