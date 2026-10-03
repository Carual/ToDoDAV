// @ts-check
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { createProxyMiddleware } = require('http-proxy-middleware');

const config = getDefaultConfig(__dirname);

// shared/ (next to frontend/) holds the code the backend uses too, such as the Markdown parser.
config.watchFolders = [path.resolve(__dirname, '../shared')];

// Same origin as in production for the web build: /proxy, /api and /feed go to the backend (npm run dev:backend),
// as frontend-react's Vite server did. PORT is the backend's (root .env or environment).
const port = process.env.PORT ?? readEnvPort() ?? '3852';
const backend = createProxyMiddleware({
  target: `http://127.0.0.1:${port}`,
  pathFilter: ['/proxy', '/api', '/feed'],
});
config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware) => (req, res, next) =>
    backend(req, res, () => metroMiddleware(req, res, next)),
};

function readEnvPort() {
  try {
    const env = require('node:fs').readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
    return env.match(/^\s*PORT\s*=\s*(\d+)/m)?.[1];
  } catch {
    return undefined;
  }
}

module.exports = config;
