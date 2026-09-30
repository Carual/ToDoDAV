import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { requireCredentials, requireFeedAccess } from './auth.ts';
import { loadConfig } from './config.ts';
import { feed } from './feed/index.ts';

const config = loadConfig();
const app = express();
app.disable('x-powered-by');


// TLS is terminated by the reverse proxy in front of ToDoDAV, which reports the browser's scheme in
// X-Forwarded-Proto. The header is only believed from loopback/private addresses (where the reverse
// proxy lives), so a client reaching the port from the internet cannot fake it.
if (config.production) app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// The task modal can show a task's location in a Google Maps iframe; nothing else may be framed.
// The Todoist import calls Todoist's API from the browser, so the user's Todoist token never reaches this server.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        frameSrc: ["'self'", 'https://www.google.com'],
        connectSrc: ["'self'", 'https://api.todoist.com'],
      },
    },
  }),
);

// Status check: works over plain HTTP too, so a fresh install can be checked from anywhere. Reveals nothing else.
app.get('/api/status', (_req, res) => {
  res.json({ status: 'ok' });
});

// In production, /proxy only works over HTTPS; plain HTTP is refused before credentials are checked.
const requireHttps: RequestHandler = (req, res, next) => {
  if (!config.production || req.secure) return next();
  res.status(403).json({ error: 'https_required' });
};

const requireLogin = requireCredentials(config.username, config.password);

// What the frontend needs to know about this install. Behind the same checks as /proxy because it
// reveals the feed token; no-store so it is not kept in any cache.
app.get('/api/config', requireHttps, requireLogin, (_req, res) => {
  const { enabled, token } = config.feed;
  res.set('Cache-Control', 'no-store').json({ feed: enabled ? { token } : undefined });
});

// Everything under /proxy goes to the CalDAV server from env: /proxy/juan/tasks/ -> CALDAV_URL + juan/tasks/.
// The host always comes from CALDAV_URL; the client only chooses the path.
app.use(
  '/proxy',
  requireHttps,
  requireLogin,
  createProxyMiddleware({
    target: config.caldavUrl.href,
    changeOrigin: true,
    logger: console,
    on: {
      proxyReq: (proxyReq, req) => {
        // MOVE: the client names the destination with its app URL (https://app/proxy/juan/work/a.ics);
        // the CalDAV server needs its own path (/juan/work/a.ics). Path-only, as RFC 4918 allows, because
        // behind a reverse proxy the server often cannot recognize its own public host and rejects the MOVE.
        const destination = req.headers.destination;
        if (typeof destination !== 'string') return;
        const path = new URL(destination, 'http://app.invalid').pathname;
        if (path.startsWith('/proxy/')) {
          proxyReq.setHeader('destination', config.caldavUrl.pathname + path.slice('/proxy/'.length));
        }
      },
      proxyRes: (proxyRes) => {
        // Keeps the browser from showing its native login prompt when the CalDAV server answers 401.
        delete proxyRes.headers['www-authenticate'];
      },
    },
  }),
);

// Read-only .ics feed for calendar apps that cannot log in to CalDAV (Google Calendar's "From URL").
// It reads the CalDAV server with the credentials from env, so the token in its URL is what guards it.
// Off unless enabled, so no install publishes anything by accident.
if (config.feed.enabled) app.use('/feed', requireHttps, requireFeedAccess(config.feed.token), feed(config));

// The built app (npm run build); any other path gets index.html for the client-side routes (/login, /tasks/<uid>).
// HTTPS-only in production like /proxy, so the login page never sends the password in the clear.
const frontendDir = fileURLToPath(new URL('../dist/frontend-react/', import.meta.url));
app.use(requireHttps, express.static(frontendDir));
app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: frontendDir }));

const server = app.listen(config.port, config.host, (error) => {
  if (error) throw error;
  const { port } = server.address() as AddressInfo;
  console.log(`ToDoDAV listening on http://${config.host}:${port}, proxying /proxy to ${config.caldavUrl.href}`);  if (config.production) {
    console.log('Production mode: /proxy and /feed only accept HTTPS requests (via the reverse proxy).');
  } else {
    console.warn('Development mode: plain HTTP is accepted. Set NODE_ENV=production when deploying.');
  }
  if (config.feed.enabled) console.log('Feed enabled: /feed');
});
