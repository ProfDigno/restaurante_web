import 'dotenv/config';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { notFound, errorHandler } from './middleware/error.js';
import { finishExpiredComandas } from './services/comandas.js';
import { assertSessionSecret } from './middleware/auth.js';

const isDevelopment = process.env.NODE_ENV !== 'production';

assertSessionSecret();

if (isDevelopment) process.env.VITE_DEV_SERVER = 'true';

const { default: app } = await import('./app.js');

if (isDevelopment) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendRoot = path.resolve(__dirname, 'frontend');
  const vite = await createViteServer({
    root: frontendRoot,
    plugins: [react()],
    server: { middlewareMode: true },
    appType: 'spa'
  });
  app.get(['/comanda', '/pedido'], async (req, res, next) => {
    try {
      const html = await readFile(path.join(frontendRoot, 'index.html'), 'utf8');
      res.type('html').send(await vite.transformIndexHtml(req.originalUrl, html));
    } catch (error) { next(error); }
  });
  app.use(vite.middlewares);
}

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Restaurante Web disponible en http://localhost:${port}`);
  let checking = false;
  const checkExpired = async () => {
    if (checking) return;
    checking = true;
    try { await finishExpiredComandas(); }
    catch (error) { console.error('No se pudieron revisar las comandas vencidas:', error); }
    finally { checking = false; }
  };
  void checkExpired();
  setInterval(checkExpired, 15000).unref();
});
