export interface Config {
  /** True only when NODE_ENV=production. Production accepts nothing but HTTPS, in both directions. */
  production: boolean;
  host: string;
  port: number;
  /** CalDAV server every /proxy request is sent to. Always ends with "/". */
  caldavUrl: URL;
  username: string;
  password: string;
  /**
   * Public read-only .ics feed (/feed/<token>/<calendar path>), for calendar apps (Google Calendar) that cannot
   * log in to CalDAV: the calendar as stored, or with its tasks turned into events (see feed/index.ts).
   */
  feed: {
    enabled: boolean;
    /** Must be the first path segment (/feed/<token>/...). Always set when the feed is enabled. */
    token: string;
  };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const problems: string[] = [];
  const production = env.NODE_ENV === 'production';

  let caldavUrl: URL | undefined;
  try {
    caldavUrl = new URL(env.CALDAV_URL ?? '');
    if (caldavUrl.protocol !== 'http:' && caldavUrl.protocol !== 'https:') problems.push('CALDAV_URL must use http or https');
    if (production && caldavUrl.protocol !== 'https:') problems.push('CALDAV_URL must use https when NODE_ENV=production');
    if (caldavUrl.username || caldavUrl.password) problems.push('CALDAV_URL must not contain credentials');
    if (caldavUrl.search || caldavUrl.hash) problems.push('CALDAV_URL must not contain a query string or fragment');
    if (!caldavUrl.pathname.endsWith('/')) caldavUrl.pathname += '/';
  } catch {
    problems.push('CALDAV_URL is missing or not a valid URL');
  }

  const username = env.CALDAV_USERNAME ?? '';
  const password = env.CALDAV_PASSWORD ?? '';
  if (!username) problems.push('CALDAV_USERNAME is required');
  if (username.includes(':')) problems.push('CALDAV_USERNAME must not contain ":"');
  if (!password) problems.push('CALDAV_PASSWORD is required');

  const port = Number(env.PORT ?? 3852);
  if (!Number.isInteger(port) || port < 0 || port > 65535) problems.push('PORT must be a valid port number');

  const flag = (name: string): boolean => {
    const value = (env[name] ?? '').trim().toLowerCase();
    if (value === 'true') return true;
    if (value !== '' && value !== 'false') problems.push(`${name} must be true or false`);
    return false;
  };
  const feed = { enabled: flag('FEED_ENABLED'), token: env.FEED_TOKEN ?? '' };
  // The token is the feed's only lock, since it reads CalDAV with the credentials above.
  // URL-safe characters only, since it travels as a path segment.
  if (feed.enabled && !/^[A-Za-z0-9_-]{32,}$/.test(feed.token)) {
    problems.push('FEED_TOKEN is required by the feed: at least 32 characters of A-Z, a-z, 0-9, "-" or "_"');
  }

  if (problems.length > 0) throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);

  return { production, host: env.HOST || '0.0.0.0', port, caldavUrl: caldavUrl!, username, password, feed };
}
