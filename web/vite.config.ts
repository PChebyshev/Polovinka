import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Собирает sw.js из шаблона: подставляет список файлов оболочки и версию. */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'polovinka-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const assetsDir = join(outDir, 'assets');
      const assets = existsSync(assetsDir) ? readdirSync(assetsDir).map((f) => `/assets/${f}`) : [];
      const shell = ['/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', ...assets];
      const version = Date.now().toString(36);
      const tpl = readFileSync('sw-template.js', 'utf8').replace("'__VERSION__'", JSON.stringify(version)).replace("'__ASSETS__'", JSON.stringify(shell));
      writeFileSync(join(outDir, 'sw.js'), tpl);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        // Библиотеки — отдельным куском: он не меняется от обновления к обновлению и остаётся в кэше
        manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
});
