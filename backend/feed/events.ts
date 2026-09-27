import express, { type Request, type Response, type Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { basicAuth } from '../auth.ts';
import type { Config } from '../config.ts';
import { calendarFileName } from './tasks.ts';

/**
 * Headers passed back to the subscriber; everything else from the CalDAV server stays behind.
 * Radicale names the file after the calendar's display name in Content-Disposition.
 */
const RESPONSE_HEADERS = ['content-type', 'content-length', 'etag', 'last-modified', 'content-disposition'];

/**
 * /feed/events/<path>: a calendar as the CalDAV server returns it, for subscribers that cannot log in.
 * It relies on GET of a calendar collection returning the whole calendar as one .ics, which Radicale does
 * (it is not part of CalDAV, so other servers may answer differently).
 */
export function eventsFeed(config: Config): Router {
  const authorization = basicAuth(config.username, config.password);
  const router = express.Router();

  router.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    res.status(405).json({ error: 'method_not_allowed' });
  });

  router.use(
    createProxyMiddleware<Request, Response>({
      target: config.caldavUrl.href,
      changeOrigin: true,
      logger: console,
      // The response is checked before any of it is sent, see proxyRes.
      selfHandleResponse: true,
      on: {
        proxyReq: (proxyReq) => {
          proxyReq.setHeader('authorization', authorization);
          proxyReq.removeHeader('cookie');
        },
        proxyRes: (proxyRes, req, res) => {
          const status = proxyRes.statusCode ?? 502;
          const type = proxyRes.headers['content-type'] ?? '';
          // The same credentials also read address books and anything else on the server;
          // only calendar data may leave through the feed.
          if (status === 304 || (status === 200 && /^text\/calendar\b/i.test(type))) {
            // Servers that do not name the file get the last path segment, as Radicale does without a display name.
            if (!proxyRes.headers['content-disposition']) res.attachment(calendarFileName(undefined, req.path));
            for (const name of RESPONSE_HEADERS) {
              const value = proxyRes.headers[name];
              if (value !== undefined) res.setHeader(name, value);
            }
            res.statusCode = status;
            proxyRes.pipe(res);
            return;
          }
          proxyRes.resume();
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'not_found' }));
        },
      },
    }),
  );

  return router;
}
