import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { writeTuned } from './src/tunedblock';

/** Dev only: balance.html → «Цели» → «Записать в config.ts» posts the picked numbers here (the `<tuned>` block). */
const tuneWrite = (): Plugin => ({
  name: 'tune-write',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__tune-write', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const sets = JSON.parse(body) as Record<string, number>;
          for (const [p, v] of Object.entries(sets)) if (!/^[\w.]+$/.test(p) || typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`плохая правка ${p}`);
          const file = resolve(__dirname, 'src/config.ts');
          writeFileSync(file, writeTuned(readFileSync(file, 'utf8'), sets));
          res.end('ok');
        } catch (err) { res.statusCode = 400; res.end(err instanceof Error ? err.message : String(err)); }
      });
    });
  },
});

export default defineConfig({
  base: './',
  plugins: [tuneWrite()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), viewer: resolve(__dirname, 'viewer.html'), roster: resolve(__dirname, 'roster.html'), board: resolve(__dirname, 'board.html'), balance: resolve(__dirname, 'balance.html') },
    },
  },
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
