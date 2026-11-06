import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Versión visible en el login: la de package.json y la fecha de compilación.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const buildDate = new Date().toISOString().slice(0, 10);

export default defineConfig({
  root: 'src/frontend',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD_DATE__: JSON.stringify(buildDate)
  },
  server: {
    port: 3000
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true
  }
});
