import type { RequestHandler } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

/** Slows down password guessing: every rejected request waits this long before getting its 401. */
const FAILURE_DELAY_MS = 1000;

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Lets the request through only if its Basic credentials equal the saved ones.
 * Hashing both sides first makes timingSafeEqual work regardless of length, so response time
 * reveals nothing about the expected values.
 */
export function requireCredentials(username: string, password: string): RequestHandler {
  const expected = digest(`${username}:${password}`);

  return (req, res, next) => {
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(req.headers.authorization ?? '');
    const received = match?.[1] ? Buffer.from(match[1], 'base64').toString('utf8') : '';
    if (timingSafeEqual(digest(received), expected)) return next();

    // No WWW-Authenticate header, so the browser never shows its native login prompt.
    setTimeout(() => res.status(401).json({ error: 'unauthorized' }), FAILURE_DELAY_MS);
  };
}

/** Authorization header the backend itself sends when it reads the CalDAV server for the feeds. */
export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'not_found' });
};

/**
 * Gate for the public feeds, which read the CalDAV server with the credentials from env.
 * The path must start with the token (/<token>/juan/tasks/); it is removed so the rest is the CalDAV path.
 * Failures answer 404 rather than 401, so a scanner cannot tell a feed is there.
 */
export function requireFeedAccess(token: string): RequestHandler {
  const expected = digest(token);

  return (req, res, next) => {
    const [, received = '', ...rest] = req.url.split('/');
    if (!timingSafeEqual(digest(received), expected)) {
      setTimeout(() => notFound(req, res, next), FAILURE_DELAY_MS);
      return;
    }
    req.url = `/${rest.join('/')}`;

    // Unlike /proxy, the caller never proved it knows the password, so it must not climb out of CALDAV_URL
    // with dot segments (also percent-encoded ones, which the CalDAV server would decode).
    let path: string;
    try {
      path = decodeURIComponent(req.path);
    } catch {
      return notFound(req, res, next);
    }
    if (path.split(/[/\\]/).some((segment) => segment === '.' || segment === '..')) return notFound(req, res, next);
    next();
  };
}
