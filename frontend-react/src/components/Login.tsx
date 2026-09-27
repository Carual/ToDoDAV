import { useState, type FormEvent } from 'react';
import { CalDavClient, NO_FEEDS, type Calendar, type Credentials, type ServerConfig } from '../api/caldav.ts';
import { LogoMark } from './icons.tsx';

export interface Session {
  client: CalDavClient;
  calendars: Calendar[];
  config: ServerConfig;
}

/** Logging in = asking the server for the user's task lists; it only works with the right credentials. */
export async function logIn(credentials: Credentials): Promise<Session> {
  const client = new CalDavClient(credentials);
  // The settings only add extras (feed links), so a backend or reverse proxy without /api/config
  // must not block the login.
  const [calendars, config] = await Promise.all([client.discoverCalendars(), client.serverConfig().catch(() => NO_FEEDS)]);
  return { client, calendars, config };
}

export function Login({ onLogin }: { onLogin: (session: Session, credentials: Credentials) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const credentials = { username: username.trim(), password };
    try {
      onLogin(await logIn(credentials), credentials);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">
          <LogoMark className="brand-mark" />
          ToDoDAV
        </div>
        <h1>Log in</h1>
        <form onSubmit={submit}>
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p className="login-hint">Use the username and password of your CalDAV server.</p>
      </div>
    </main>
  );
}
