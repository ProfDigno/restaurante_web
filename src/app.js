import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.routes.js';
import menuRoutes from './routes/menu.routes.js';
import mesaRoutes from './routes/mesa.routes.js';
import grupoMenuRoutes from './routes/grupo-menu.routes.js';
import categoriaMenuRoutes from './routes/categoria-menu.routes.js';
import unidadMenuRoutes from './routes/unidad-menu.routes.js';
import productoMenuRoutes from './routes/producto-menu.routes.js';
import zonaClienteRoutes from './routes/zona-cliente.routes.js';
import clienteRoutes from './routes/cliente.routes.js';
import entregadorDeliveryRoutes from './routes/entregador-delivery.routes.js';
import unidadMedidaRoutes from './routes/unidad-medida.routes.js';
import unidadConversionRoutes from './routes/unidad-conversion.routes.js';
import ingredienteRoutes from './routes/ingrediente.routes.js';
import mesaConfigRoutes from './routes/mesa-config.routes.js';
import ubicacionMesaRoutes from './routes/ubicacion-mesa.routes.js';
import pedidoRoutes from './routes/pedido.routes.js';
import comandaRoutes from './routes/comanda.routes.js';
import kpiPedidoRoutes from './routes/kpi-pedido.routes.js';
import formaPagoRoutes from './routes/forma-pago.routes.js';
import cajaRoutes from './routes/caja.routes.js';
import gastoTipoRoutes from './routes/gasto-tipo.routes.js';
import gastoRoutes from './routes/gasto.routes.js';
import kpiGastoRoutes from './routes/kpi-gasto.routes.js';
import kpiCompraRoutes from './routes/kpi-compra.routes.js';
import personalRoutes from './routes/personal.routes.js';
import valeRoutes from './routes/vale.routes.js';
import proveedorRoutes from './routes/proveedor.routes.js';
import compraRoutes from './routes/compra.routes.js';
import facturaRoutes from './routes/factura.routes.js';
import datosRestauranteRoutes from './routes/datos-restaurante.routes.js';
import comandaConfigRoutes from './routes/comanda-config.routes.js';
import securityRoutes from './routes/security.routes.js';
import auditoriaRoutes from './routes/auditoria.routes.js';
import kpiRentabilidadRoutes from './routes/kpi-rentabilidad.routes.js';
import kpiValeRoutes from './routes/kpi-vale.routes.js';
import cargoPersonalRoutes from './routes/cargo-personal.routes.js';
import { requireAuth, requirePermission } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/error.js';
import { sameOriginWrites } from './middleware/security.js';

// Versión de package.json, informada en /api/health para comprobar qué está desplegado.
const { version: appVersion } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const app = express();
// Detrás de nginx: TRUST_PROXY=loopback para que req.ip sea la IP real del cliente.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, '../uploads');

app.use(express.json());
app.use(cookieParser());
app.use('/api', sameOriginWrites);
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'restaurante-web', version: appVersion }));
app.use('/uploads', express.static(uploadsDir, { maxAge: '1h' }));
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/mesas', requireAuth, (req, res, next) =>
  req.path.startsWith('/historial')
    ? requirePermission('historial-mesas')(req, res, next)
    : requirePermission('mesas', ['pedidos'])(req, res, next), mesaRoutes);
app.use('/api/grupos-menu', requireAuth, requirePermission('grupos', ['menu']), grupoMenuRoutes);
app.use('/api/categorias-menu', requireAuth, requirePermission('categorias', ['menu']), categoriaMenuRoutes);
app.use('/api/unidades-menu', requireAuth, requirePermission('unidades-menu', ['menu']), unidadMenuRoutes);
app.use('/api/productos-menu', requireAuth, requirePermission('menu'), productoMenuRoutes);
app.use('/api/zonas-clientes', requireAuth, requirePermission('zonas', ['clientes', 'pedidos']), zonaClienteRoutes);
app.use('/api/clientes', requireAuth, (req, res, next) =>
  req.method === 'POST' && req.user.permisos.includes('FORM_PEDIDOS') ? next() : requirePermission('clientes')(req, res, next), clienteRoutes);
app.use('/api/entregadores-delivery', requireAuth, requirePermission('delivery'), entregadorDeliveryRoutes);
app.use('/api/unidades-medida', requireAuth, requirePermission('unidades-medida', ['ingredientes', 'conversiones-unidad']), unidadMedidaRoutes);
app.use('/api/unidades-conversion', requireAuth, requirePermission('conversiones-unidad'), unidadConversionRoutes);
app.use('/api/ingredientes', requireAuth, requirePermission('ingredientes', ['menu']), ingredienteRoutes);
app.use('/api/mesas-config', requireAuth, requirePermission('mesas-config'), mesaConfigRoutes);
app.use('/api/ubicaciones-mesa', requireAuth, requirePermission('ubicaciones-mesa', ['mesas-config']), ubicacionMesaRoutes);
app.use('/api/pedidos', requireAuth, requirePermission('pedidos'), pedidoRoutes);
app.use('/api/comandas', requireAuth, requirePermission('comanda'), comandaRoutes);
app.use('/api/kpi-pedidos', requireAuth, requirePermission('kpi-pedidos'), kpiPedidoRoutes);
app.use('/api/kpi-rentabilidad', requireAuth, requirePermission('kpi-rentabilidad'), kpiRentabilidadRoutes);
app.use('/api/formas-pago', requireAuth, requirePermission('formas-pago'), formaPagoRoutes);
app.use('/api/cajas', requireAuth, (req, res, next) =>
  req.path === '/estado' || req.path === '/abrir' ? next() : requirePermission('caja')(req, res, next), cajaRoutes);
app.use('/api/gasto-tipos', requireAuth, requirePermission('gasto-tipos'), gastoTipoRoutes);
app.use('/api/gastos', requireAuth, requirePermission('gastos'), gastoRoutes);
app.use('/api/kpi-gastos', requireAuth, requirePermission('kpi-gastos'), kpiGastoRoutes);
app.use('/api/kpi-compras', requireAuth, requirePermission('kpi-compras'), kpiCompraRoutes);
app.use('/api/personal', requireAuth, requirePermission('personal'), personalRoutes);
// Personal lee el catálogo de cargos para su selector; solo Cargos lo modifica.
app.use('/api/cargos-personal', requireAuth, requirePermission('cargos', ['personal']), cargoPersonalRoutes);
app.use('/api/vales', requireAuth, requirePermission('vales'), valeRoutes);
app.use('/api/kpi-vales', requireAuth, requirePermission('kpi-vales'), kpiValeRoutes);
app.use('/api/proveedores', requireAuth, requirePermission('proveedores'), proveedorRoutes);
app.use('/api/compras', requireAuth, requirePermission('compras'), compraRoutes);
app.use('/api/facturas', requireAuth, requirePermission('facturas'), facturaRoutes);
app.use('/api/datos-restaurante', requireAuth, requirePermission('datos-restaurante'), datosRestauranteRoutes);
app.use('/api/comanda-config', requireAuth, requirePermission('configuracion-comanda'), comandaConfigRoutes);
app.use('/api/auditoria', requireAuth, requirePermission('auditoria'), auditoriaRoutes);
app.use('/api', securityRoutes);

// En desarrollo, Vite se monta como middleware desde server.js para compartir
// el mismo puerto que la API. En producción Express sirve el build generado.
if (process.env.VITE_DEV_SERVER !== 'true') {
  const frontendDist = path.resolve(__dirname, '../dist');
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(frontendDist, 'index.html')));
  app.use(notFound);
  app.use(errorHandler);
}

export default app;
