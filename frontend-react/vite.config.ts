import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Same PORT as the backend (root .env or environment), so /proxy always reaches it.
  // Only used here in the config; nothing from .env is exposed to the browser code.
  const { PORT = '3852' } = loadEnv(mode, repoRoot, '');

  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [react()],
    build: {
      outDir: fileURLToPath(new URL('../dist/frontend-react', import.meta.url)),
      emptyOutDir: true,
    },
    server: {
      // Same origin as in production: /proxy, /api and /feed go to the backend (npm run dev:backend).
      proxy: Object.fromEntries(['/proxy', '/api', '/feed'].map((path) => [path, `http://127.0.0.1:${PORT}`])),
    },
  };
});
