import 'dotenv/config';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { notFound, errorHandler } from './middleware/error.js';
import { finishExpiredComandas } from './services/comandas.js';
import { leerConfigComanda } from './services/comanda-config.js';
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
  app.get(['/comanda', '/pedido', '/mesa'], async (req, res, next) => {
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
// HOST=127.0.0.1 en el servidor: solo accesible a través de nginx.
app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Restaurante Web disponible en http://localhost:${port}`);
  // El intervalo de revisión se lee de la configuración de la comanda en cada ciclo.
  const checkExpired = async () => {
    let seconds = 15;
    try {
      seconds = (await leerConfigComanda()).chequeo_limite_seg;
      await finishExpiredComandas();
    } catch (error) { console.error('No se pudieron revisar las comandas vencidas:', error); }
    setTimeout(checkExpired, seconds * 1000).unref();
  };
  void checkExpired();
});
