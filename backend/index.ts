import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { AddressInfo } from 'node:net';
import { requireCredentials } from './auth.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = express();
app.disable('x-powered-by');

// TLS is terminated by the reverse proxy in front of ToDoDAV, which reports the browser's scheme in
// X-Forwarded-Proto. The header is only believed from loopback/private addresses (where the reverse
// proxy lives), so a client reaching the port from the internet cannot fake it.
if (config.production) app.set('trust proxy', 'loopback, linklocal, uniquelocal');

app.use(helmet());

// Status check: works over plain HTTP too, so a fresh install can be checked from anywhere. Reveals nothing else.
app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

// In production, /proxy only works over HTTPS; plain HTTP is refused before credentials are checked.
const requireHttps: RequestHandler = (req, res, next) => {
  if (!config.production || req.secure) return next();
  res.status(403).json({ error: 'https_required' });
};

// Everything under /proxy goes to the CalDAV server from env: /proxy/juan/tasks/ -> CALDAV_URL + juan/tasks/.
// The host always comes from CALDAV_URL; the client only chooses the path.
app.use(
  '/proxy',
  requireHttps,
  requireCredentials(config.username, config.password),
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

const server = app.listen(config.port, config.host, (error) => {
  if (error) throw error;
  const { port } = server.address() as AddressInfo;
  console.log(`ToDoDAV listening on http://${config.host}:${port}, proxying /proxy to ${config.caldavUrl.href}`);
  if (config.production) {
    console.log('Production mode: /proxy only accepts HTTPS requests (via the reverse proxy).');
  } else {
    console.warn('Development mode: plain HTTP is accepted. Set NODE_ENV=production when deploying.');
  }
});
