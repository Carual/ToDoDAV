import { useCallback, useEffect, useRef, useState } from 'react';
import type { Credentials } from './api/caldav.ts';
import { logIn, Login, type Session } from './components/Login.tsx';
import { LogoMark } from './components/icons.tsx';
import { MainPage } from './components/MainPage.tsx';
import { Spinner } from './components/Spinner.tsx';
import { navigate, parseRoute, usePath } from './router.ts';

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
  const path = usePath();
  const route = parseRoute(path);
  // Where to go after logging in: a task link opened while logged out ends up on that task.
  const afterLogin = useRef('/tasks');

  // /login without a session, /tasks... with one. Replace, not push, so Back never lands on a redirect.
  useEffect(() => {
    if (restoring) return;
    if (!session && route.name !== 'login') {
      if (route.name === 'tasks') afterLogin.current = path;
      navigate('/login', { replace: true });
    } else if (session && route.name !== 'tasks') {
      navigate(afterLogin.current, { replace: true });
      afterLogin.current = '/tasks';
    }
  }, [restoring, session, route.name, path]);

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

  if (restoring) {
    return (
      <div className="splash">
        <LogoMark className="brand-mark" />
        <Spinner />
      </div>
    );
  }
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
  return (
    <MainPage
      session={session}
      openUid={route.name === 'tasks' ? route.uid : undefined}
      onLogout={logOut}
      onCalendarsChange={(calendars) => setSession((current) => current && { ...current, calendars })}
    />
  );
}
