import {
  CalDavClient,
  CalDavError,
  NO_FEEDS,
  type Calendar,
  type Credentials,
  type ServerConfig,
  type Transport,
} from './caldav.ts';

export interface Session {
  client: CalDavClient;
  /** The task lists. */
  calendars: Calendar[];
  /** The calendars that take journal entries (some are task lists too). */
  journals: Calendar[];
  config: ServerConfig;
}

/** Logging in = asking the server for the user's task lists and journals; it only works with the right credentials. */
export async function logIn(credentials: Credentials, transport: Transport): Promise<Session> {
  const client = new CalDavClient(credentials, transport);
  // The settings only add extras (feed links), so a backend or reverse proxy without /api/config
  // must not block the login.
  const [{ tasks, journals }, config] = await Promise.all([
    client.discoverCalendars(),
    client.serverConfig().catch(() => NO_FEEDS),
  ]);
  return { client, calendars: tasks, journals, config };
}

/**
 * The server address as typed -> `https://host/path`, without a trailing slash. `https://` is assumed when no scheme
 * is given. Plain `http://` only when `allowHttp`: Basic auth sends the password with every request.
 */
export function normalizeServerUrl(input: string, allowHttp: boolean): string {
  let url = input.trim();
  if (!url) throw new Error('Enter the address of your server.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
  const match = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)$/i.exec(url.replace(/[?#].*$/, ''));
  if (!match) throw new Error('That is not a server address.');
  const [, scheme, host, path] = match as unknown as [string, string, string, string];
  if (host.includes('@')) throw new Error('Put the username and password in their own fields, not in the address.');
  if (scheme.toLowerCase() === 'http' && !allowHttp) {
    throw new Error('Use an https:// address: the password is sent with every request.');
  }
  return `${scheme.toLowerCase()}://${host}${path.replace(/\/+$/, '')}`;
}

/**
 * Finds out how to reach the server the user typed, and logs in. A ToDoDAV backend answers /api/status and is used
 * through its /proxy (which also brings its feeds); anything else is taken as the CalDAV server itself.
 */
export async function connect(serverUrl: string, credentials: Credentials): Promise<{ session: Session; transport: Transport }> {
  if (await isToDoDav(serverUrl)) {
    const transport: Transport = { kind: 'proxy', origin: serverUrl };
    return { session: await logIn(credentials, transport), transport };
  }

  // A collection's URL ends with a slash; some servers redirect or refuse the address without it.
  const direct: Transport = { kind: 'direct', url: `${serverUrl}/` };
  try {
    return { session: await logIn(credentials, direct), transport: direct };
  } catch (error) {
    // The address may be the server's home page rather than its CalDAV root; RFC 6764 has /.well-known/caldav
    // point there. Not worth trying when the server is unreachable or already refused the password.
    if (!(error instanceof CalDavError) || error.status === 0 || error.status === 401) throw error;
    const origin = /^https?:\/\/[^/]+/i.exec(serverUrl)?.[0];
    if (!origin) throw error;
    // Without a trailing slash: servers often match this exact path to send the redirect.
    const wellKnown: Transport = { kind: 'direct', url: `${origin}/.well-known/caldav` };
    try {
      return { session: await logIn(credentials, wellKnown), transport: wellKnown };
    } catch {
      throw error;
    }
  }
}

async function isToDoDav(serverUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${serverUrl}/api/status`, { signal: controller.signal });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: unknown } | null;
    return body?.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
