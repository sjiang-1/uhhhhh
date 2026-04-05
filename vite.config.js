import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Pin project root (fixes /src/... resolution on Linux CI e.g. Vercel)
  root: __dirname,
  server: {
    proxy: {
      '/api/claude': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/claude/, '/v1/messages'),
        configure: process.env.ANTHROPIC_API_KEY
          ? (proxy) => {
              proxy.on('proxyReq', (proxyReq) => {
                proxyReq.setHeader('x-api-key', process.env.ANTHROPIC_API_KEY);
                proxyReq.setHeader('anthropic-version', '2023-06-01');
                proxyReq.setHeader('content-type', 'application/json');
              });
            }
          : undefined,
      },
    },
  },
});
