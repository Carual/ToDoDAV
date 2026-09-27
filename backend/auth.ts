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
