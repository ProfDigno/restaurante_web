import 'dotenv/config';
import pg from 'pg';
import { readFile, writeFile } from 'node:fs/promises';

// Importa la base del sistema anterior (SisDaoSamu3, base bdgorila_12) a una base NUEVA del sistema
// restaurante (por defecto bdrestaurante_gorila). La base actual (DB_NAME) solo se lee: de ella se copia
// la configuración (usuarios, roles, permisos, formas de pago, mesas, comanda, datos del restaurante).
//
//   node db/migrate-gorila.js --dry-run            prepara todo en memoria e informa (no escribe nada)
//   node db/migrate-gorila.js --apply              crea la base nueva, importa y verifica (todo o nada)
//   node db/migrate-gorila.js --apply --recreate   borra y vuelve a crear la base nueva
//
// Equivalencias (ver SisDaoSamu3: json_array_pedido.java y PosImprimir_caja_cierre.java):
//   item_venta P/N = producto · I "##OBS:" / "++(AGRE)>" = Obs: del producto (con precio) · D = delivery · S = descuento.
//   venta EMITIDO o TERMINADO = venta válida (pagado) · ANULADO = anulado.
//   Cierre de caja: apertura + ventas − gastos − delivery; el delivery se le pagaba al entregador al cerrar:
//   en cada caja se registra un "Pago a delivery" (gasto + pago_delivery) para que el saldo y la diferencia coincidan.

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const recreate = args.includes('--recreate');
const targetArg = args.find(a => a.startsWith('--target='));
for (const a of args) if (!['--apply', '--dry-run', '--recreate'].includes(a) && !a.startsWith('--target=') && !a.startsWith('--report=')) throw new Error(`Opción desconocida: ${a}`);

const SOURCE_DB = process.env.GORILA_SOURCE_DB || 'bdgorila_12';
const CONFIG_DB = process.env.DB_NAME || 'bdrestaurante_web';
const TARGET_DB = targetArg ? targetArg.split('=')[1] : (process.env.GORILA_TARGET_DB || 'bdrestaurante_gorila');
const REPORT = (args.find(a => a.startsWith('--report=')) || '').split('=')[1] || '../gorila-import-report.json';
if (!/^(bdrestaurante_gorila|gorila_test_)[a-z0-9_]*$/.test(TARGET_DB)) throw new Error('La base destino debe llamarse bdrestaurante_gorila… o gorila_test_…');
if ([SOURCE_DB, CONFIG_DB].includes(TARGET_DB)) throw new Error('La base destino no puede ser el origen ni la base actual');
const ACTOR = 'MIGRACION_GORILA';
const IMPORT_DATE = new Date();
const base = { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '' };

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const clean = v => String(v ?? '').trim().replace(/\s+/g, ' ');
const key = v => clean(v).toLowerCase();
const num = v => Number(v || 0);
const clip = (v, n) => { const s = clean(v); return s.length > n ? s.slice(0, n) : s; };
const ENTREGA = { '#>DELIVERY<#': 'DELIVERY', '#>BUSCAR_PED<#': 'BUSCAR', '#>COMER_ACA<#': 'COMER_ACA' };
const CUENTA = { DELIVERY: 'DELIVERY', BUSCAR: 'BUSCAR', COMER_ACA: 'SALON' };
// Teléfonos y RUC de relleno del sistema anterior ("0000", "44444401", "."…): quedan vacíos.
const fillerPhone = v => { const s = clean(v); const digits = s.replace(/\D/g, ''); return !s || digits.length < 6 || /^0+$/.test(digits); };
const fillerRuc = v => { const s = clean(v); return !s || /^4444440/.test(s) || !/[0-9]/.test(s) || /^0+$/.test(s.replace(/\D/g, '')); };

// ---------------------------------------------------------------- lectura
async function readSource() {
  const c = new pg.Client({ ...base, database: SOURCE_DB, application_name: 'gorila_import_source' });
  await c.connect();
  await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const q = async sql => (await c.query(sql)).rows;
  try {
    return {
      usuarios: await q('SELECT idusuario, usuario, nombre FROM usuario'),
      categorias: await q('SELECT * FROM producto_categoria ORDER BY idproducto_categoria'),
      unidades: await q('SELECT * FROM producto_unidad ORDER BY idproducto_unidad'),
      grupos: await q('SELECT * FROM producto_grupo ORDER BY idproducto_grupo'),
      productos: await q('SELECT * FROM producto ORDER BY idproducto'),
      zonas: await q('SELECT * FROM zona_delivery ORDER BY idzona_delivery'),
      clientes: await q('SELECT * FROM cliente ORDER BY idcliente'),
      entregadores: await q('SELECT * FROM entregador ORDER BY identregador'),
      gastoTipos: await q('SELECT * FROM gasto_tipo ORDER BY idgasto_tipo'),
      gastos: await q("SELECT * FROM gasto ORDER BY idgasto"),
      ventas: await q('SELECT * FROM venta ORDER BY idventa'),
      items: await q('SELECT iditem_venta, fk_idventa, tipo, descripcion, precio_venta, precio_compra, cantidad, fk_idproducto FROM item_venta ORDER BY fk_idventa, iditem_venta'),
      tarjetas: await q('SELECT * FROM venta_tarjeta ORDER BY idventa_tarjeta'),
      cierres: await q('SELECT * FROM caja_cierre ORDER BY idcaja_cierre'),
      detalles: await q('SELECT * FROM caja_detalle ORDER BY idcaja_detalle'),
      itemCierre: await q('SELECT fk_idcaja_cierre, fk_idcaja_detalle FROM item_caja_cierre')
    };
  } finally { await c.query('ROLLBACK'); await c.end(); }
}

const CONFIG_TABLES = ['usuario_rol', 'usuario_rol_evento', 'usuario_rol_item', 'usuario', 'forma_pago', 'ubicacion_mesa', 'mesa',
  'datos_restaurante', 'comanda_config', 'comanda_color', 'gasto_tipo', 'unidad_medida', 'unidad_conversion', 'cargo_personal'];

async function readConfig() {
  const c = new pg.Client({ ...base, database: CONFIG_DB, application_name: 'gorila_import_config' });
  await c.connect();
  await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const out = {};
    for (const t of CONFIG_TABLES) {
      const exists = (await c.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1", [t])).rowCount;
      out[t] = exists ? (await c.query(`SELECT * FROM ${t}`)).rows : [];
    }
    return out;
  } finally { await c.query('ROLLBACK'); await c.end(); }
}

// ---------------------------------------------------------------- preparación (en memoria, sin escribir)
function prepare(src, cfg) {
  const report = { origen: {}, importado: {}, normalizado: {}, avisos: {} };
  for (const [k, v] of Object.entries(src)) report.origen[k] = v.length;
  const login = new Map(src.usuarios.map(u => [u.idusuario, clip(u.usuario || u.nombre, 60) || ACTOR]));
  const who = id => login.get(id) || ACTOR;

  // Formas de pago de la configuración conservada.
  const forma = name => { const f = cfg.forma_pago.find(x => key(x.nombre) === key(name)); return f?.idforma_pago; };
  const FORMA = { efectivo: forma('EFECTIVO'), tarjeta: forma('TARJETA') ?? forma('Débito'), debito: forma('Débito') ?? forma('TARJETA'), credito: forma('Crédito') ?? forma('TARJETA'), transferencia: forma('TRANSFERENCIA') };
  for (const [k, v] of Object.entries(FORMA)) assert(v !== undefined, `Falta la forma de pago "${k}" en la configuración actual`);

  // Catálogo (se conservan los ID del sistema anterior).
  const uniq = (rows, idKey, label) => { const seen = new Set(); for (const r of rows) { const k = key(r.nombre); assert(k, `${label} ${r[idKey]} sin nombre`); if (seen.has(k)) r.nombre = `${clean(r.nombre)} (${r[idKey]})`; seen.add(key(r.nombre)); } return rows; };
  const categorias = uniq(src.categorias, 'idproducto_categoria', 'Categoría').map(r => ({ idcategoria_menu: r.idproducto_categoria, nombre: clip(r.nombre, 80), orden: Math.max(0, Math.min(32767, num(r.orden))), activa: r.activar !== false, creado_por: ACTOR }));
  const unidades = uniq(src.unidades, 'idproducto_unidad', 'Unidad').map((r, i) => ({ idunidad_menu: r.idproducto_unidad, nombre: clip(r.nombre, 80), orden: i + 1, activo: true, creado_por: ACTOR }));
  const grupos = uniq(src.grupos, 'idproducto_grupo', 'Grupo').map((r, i) => ({ idgrupo_menu: r.idproducto_grupo, nombre: clip(r.nombre, 80), orden: i + 1, activo: true, creado_por: ACTOR }));
  const catIds = new Set(categorias.map(r => r.idcategoria_menu)), uniIds = new Set(unidades.map(r => r.idunidad_menu)), gruIds = new Set(grupos.map(r => r.idgrupo_menu));
  const productos = src.productos.map(p => {
    assert(catIds.has(p.fk_idproducto_categoria) && uniIds.has(p.fk_idproducto_unidad) && gruIds.has(p.fk_idproducto_grupo), `Producto ${p.idproducto}: catálogo inexistente`);
    const pv = Math.round(num(p.precio_venta)), pc = Math.round(num(p.precio_compra));
    return { idproducto_menu: p.idproducto, fk_idcategoria_menu: p.fk_idproducto_categoria, fk_idunidad_menu: p.fk_idproducto_unidad, fk_idgrupo_menu: p.fk_idproducto_grupo,
      nombre: clip(p.nombre, 120) || `Producto ${p.idproducto}`, precio_venta: Math.max(0, pv), precio_compra: pc > 0 && pc < pv ? pc : 0,
      orden: Math.max(0, Math.min(32767, num(p.orden))), stock_actual: Math.max(0, Math.round(num(p.stock))), stock_minimo: 0, activo: p.activar !== false,
      es_descontar_stock: false, es_cocina: p.cocina !== false, es_vender: p.vender !== false, es_comprar: p.comprar === true, creado_por: ACTOR };
  });
  report.normalizado.productos_costo_igual_precio = src.productos.filter(p => num(p.precio_compra) >= num(p.precio_venta) && num(p.precio_venta) > 0).length;
  const productIds = new Set(productos.map(p => p.idproducto_menu));
  let placeholderProduct = null;
  const productFor = id => {
    if (productIds.has(id)) return id;
    if (!placeholderProduct) {
      placeholderProduct = { ...productos[0], idproducto_menu: Math.max(...productIds) + 1, nombre: 'Producto eliminado (importado)', precio_venta: 0, precio_compra: 0, activo: false, es_vender: false, stock_actual: 0 };
      productos.push(placeholderProduct); productIds.add(placeholderProduct.idproducto_menu);
    }
    return placeholderProduct.idproducto_menu;
  };

  // Zonas: se unifican las de igual nombre.
  const zonaByName = new Map(), zonaMap = new Map(), zonas = [];
  for (const z of src.zonas) {
    const k = key(z.nombre) || `zona ${z.idzona_delivery}`;
    if (!zonaByName.has(k)) { const row = { idzona_cliente: zonas.length + 1, codigo: `GOR-${z.idzona_delivery}`, nombre: clip(z.nombre, 100) || `Zona ${z.idzona_delivery}`, precio_delivery: Math.max(0, Math.round(num(z.delivery))), activo: true, creado_por: ACTOR }; zonas.push(row); zonaByName.set(k, row); }
    zonaMap.set(z.idzona_delivery, zonaByName.get(k));
  }
  report.normalizado.zonas_unificadas = src.zonas.length - zonas.length;

  // Clientes: teléfono y RUC de relleno quedan vacíos; los repetidos reales los conserva el primero.
  const phoneSeen = new Set(), rucSeen = new Set();
  let fillerPhones = 0, fillerRucs = 0, sharedPhones = 0, sharedRucs = 0;
  const clientes = src.clientes.map(cl => {
    let telefono = clean(cl.telefono), ruc = clean(cl.ruc); const notas = [];
    if (fillerPhone(telefono)) { if (telefono) fillerPhones++; telefono = null; }
    else if (phoneSeen.has(telefono)) { sharedPhones++; notas.push(`Tel. compartido: ${telefono}`); telefono = null; }
    else phoneSeen.add(telefono);
    if (fillerRuc(ruc)) { if (ruc) fillerRucs++; ruc = null; }
    else if (rucSeen.has(key(ruc))) { sharedRucs++; notas.push(`RUC repetido: ${ruc}`); ruc = null; }
    else rucSeen.add(key(ruc));
    const direccion = clean(cl.direccion);
    return { idcliente: cl.idcliente, nombre_completo: clip(cl.nombre, 120) || `Cliente ${cl.idcliente}`, ruc: ruc ? clip(ruc, 30) : null, telefono: telefono ? clip(telefono, 40) : null,
      direccion: direccion && !/^sin direcci[oó]n$/i.test(direccion) ? clip(direccion, 250) : null, notas: notas.join(' · ') || null, activo: true,
      es_ocacional: key(cl.nombre) === 'ocasional' && cl.idcliente === 1, fk_idzona_cliente: zonaMap.get(cl.fk_idzona_delivery)?.idzona_cliente ?? null,
      fecha_creado: cl.fecha_inicio || IMPORT_DATE, creado_por: ACTOR };
  });
  assert(clientes.filter(c => c.es_ocacional).length <= 1, 'Más de un cliente ocasional');
  Object.assign(report.normalizado, { telefonos_relleno_vacios: fillerPhones, ruc_relleno_vacios: fillerRucs, telefonos_compartidos: sharedPhones, ruc_repetidos: sharedRucs });
  const clientById = new Map(clientes.map(c => [c.idcliente, c]));

  // Entregadores (se conserva el ID; "LOCAL" queda inactivo).
  const entregadores = src.entregadores.map(e => ({ identregador_delivery: e.identregador, nombre_completo: clip(e.nombre, 120) || `Entregador ${e.identregador}`, activo: e.activar !== false, creado_por: ACTOR }));
  const courierIds = new Set(entregadores.map(e => e.identregador_delivery));
  const localCourier = entregadores.find(e => key(e.nombre_completo) === 'local')?.identregador_delivery ?? entregadores[0]?.identregador_delivery;

  // Mesas: las de la configuración conservada; las ventas "SIN-MESA" o con mesa inexistente van a una mesa inactiva "Sin mesa".
  const mesaByNumber = new Map(cfg.mesa.map(m => [Number(m.numero), m.idmesa]));
  const sinMesaUbicacion = { idubicacion_mesa: Math.max(0, ...cfg.ubicacion_mesa.map(u => u.idubicacion_mesa)) + 1, nombre: 'Importado (sin mesa)', orden: 99, activo: false, creado_por: ACTOR };
  const sinMesa = { idmesa: Math.max(0, ...cfg.mesa.map(m => m.idmesa)) + 1, numero: [0, ...Array.from({ length: 900 }, (_, i) => 900 + i)].find(n => !mesaByNumber.has(n)), capacidad: 1, fk_idubicacion_mesa: sinMesaUbicacion.idubicacion_mesa, estado: 'libre', activa: false, creado_por: ACTOR };
  let ventasSinMesa = 0;
  const mesaFor = nombre => { const m = /MESA[\s-]*(\d+)/i.exec(nombre || ''); const id = m ? mesaByNumber.get(Number(m[1])) : undefined; if (id === undefined) ventasSinMesa++; return id ?? sinMesa.idmesa; };

  // Caja: a qué cierre pertenece cada movimiento y qué cobró cada venta.
  const cierreDeDetalle = new Map(src.itemCierre.map(r => [r.fk_idcaja_detalle, r.fk_idcaja_cierre]));
  const cierreIds = new Set(src.cierres.map(r => r.idcaja_cierre));
  const cobroDeVenta = new Map(), aperturas = new Map(), cierresMonto = new Map(), gastoCaja = new Map();
  let movSinCierre = 0;
  for (const d of src.detalles) {
    const cierre = cierreDeDetalle.get(d.idcaja_detalle);
    const enCaja = cierre !== undefined && cierreIds.has(cierre);
    if (!enCaja) movSinCierre++;
    if (/^VENTA_/.test(d.tabla_origen) && d.estado === 'EMITIDO' && !cobroDeVenta.has(d.id_origen)) cobroDeVenta.set(d.id_origen, { ...d, cierre: enCaja ? cierre : null });
    if (enCaja && d.tabla_origen === 'CAJA_ABRIR') aperturas.set(cierre, (aperturas.get(cierre) || 0) + num(d.monto_caja));
    if (enCaja && d.tabla_origen === 'CAJA_CERRAR') cierresMonto.set(cierre, (cierresMonto.get(cierre) || 0) + num(d.monto_cierre));
    if (d.tabla_origen === 'GASTO' && d.estado === 'EMITIDO') gastoCaja.set(d.id_origen, { cierre: enCaja ? cierre : null, fecha: d.fecha_emision });
  }
  report.avisos.movimientos_caja_sin_cierre = movSinCierre;
  const tarjetaDe = new Map();
  for (const t of src.tarjetas) { const list = tarjetaDe.get(t.fk_idventa) || []; list.push(t); tarjetaDe.set(t.fk_idventa, list); }

  // Ítems agrupados por venta.
  const itemsDe = new Map();
  for (const it of src.items) { const list = itemsDe.get(it.fk_idventa) || []; list.push(it); itemsDe.set(it.fk_idventa, list); }

  const pedidos = [], cuentas = [], detalles = [], pagos = [], cajaItems = [];
  let ventasSinProductos = 0, obsHuerfanas = 0, ajustesDescuento = 0, ajustesRecargo = 0, montoAjustes = 0, ventasSinCobroCaja = 0;
  const deliveryPorCaja = new Map(); // cierre -> Map(entregador -> { total, pedidos:[{id,monto}] })
  const deliverySinCaja = new Map(); // entregador -> { total, pedidos, desde, hasta }
  let pagoId = 0, cajaItemId = 0;
  // Ventas con cobro negativo = devolución de plata al cliente en el sistema anterior: van como gasto en su caja.
  const devoluciones = [];

  for (const v of src.ventas) {
    const tipo = ENTREGA[v.tipo_entrega];
    assert(tipo, `Venta ${v.idventa}: tipo de entrega desconocido ${v.tipo_entrega}`);
    const anulada = v.estado === 'ANULADO';
    assert(['EMITIDO', 'TERMINADO', 'ANULADO'].includes(v.estado), `Venta ${v.idventa}: estado desconocido ${v.estado}`);
    const cliente = clientById.get(v.fk_idcliente);
    assert(cliente, `Venta ${v.idventa}: cliente inexistente`);
    const usuario = who(v.fk_idusuario);
    const fecha = v.fecha_inicio, fechaFin = v.fecha_fin && v.fecha_fin >= v.fecha_inicio ? v.fecha_fin : v.fecha_inicio;

    // Líneas: P/N productos; I se agregan como "Obs:" (con precio) al producto anterior; D delivery; S descuento.
    const lines = []; let delivery = 0, descuento = 0; const pendingObs = [];
    for (const it of itemsDe.get(v.idventa) || []) {
      const precio = Math.round(num(it.precio_venta)), cant = num(it.cantidad);
      if (it.tipo === 'P' || it.tipo === 'N') {
        const pc = Math.round(num(it.precio_compra));
        lines.push({ fk_idproducto_menu: productFor(it.fk_idproducto), cantidad: Math.max(1, Math.round(cant)), precio_venta: Math.max(0, precio), precio_compra: pc > 0 && pc < precio ? pc : 0, obs: [], extra: 0 });
        if (pendingObs.length) { const first = lines[0]; first.obs.push(...pendingObs.map(o => o.text)); first.extra += pendingObs.reduce((s, o) => s + o.monto, 0); pendingObs.length = 0; }
      } else if (it.tipo === 'I') {
        const raw = clean(it.descripcion);
        const text = raw.replace(/^##OBS:\s*/i, '').replace(/^\+\+\(AGRE\)>\s*/i, '+ ').trim();
        const o = { text: text || raw, monto: precio * cant };
        if (lines.length) { lines[lines.length - 1].obs.push(o.text); lines[lines.length - 1].extra += o.monto; } else pendingObs.push(o);
      } else if (it.tipo === 'D') delivery += precio * cant;
      else if (it.tipo === 'S') descuento += -precio * cant;
      else throw new Error(`Venta ${v.idventa}: tipo de ítem desconocido ${it.tipo}`);
    }
    if (pendingObs.length) obsHuerfanas += pendingObs.length;
    if (!lines.length) ventasSinProductos++;
    for (const l of lines) {
      l.precio_observacion = l.extra > 0 ? Math.floor(l.extra / l.cantidad) : 0;
      l.redondeo = l.extra > 0 ? l.extra - l.precio_observacion * l.cantidad : 0;
    }
    const productosTotal = lines.reduce((s, l) => s + l.cantidad * (l.precio_venta + l.precio_observacion), 0);
    if (!delivery && tipo === 'DELIVERY') delivery = Math.max(0, Math.round(num(v.monto_delivery)));
    if (tipo !== 'DELIVERY') delivery = 0;
    descuento = Math.max(0, Math.round(descuento));

    // Lo cobrado: el movimiento de caja (lo que usaba el cierre) o, si no tiene, los montos de la venta.
    const caja = !anulada ? cobroDeVenta.get(v.idventa) : null;
    if (!anulada && !caja) ventasSinCobroCaja++;
    const ef = Math.round(num(caja ? caja.monto_venta_efectivo : v.monto_venta_efectivo));
    const tj = Math.round(num(caja ? caja.monto_venta_tarjeta : v.monto_venta_tarjeta));
    const tr = Math.round(num(caja ? caja.monto_venta_transferencia : v.monto_venta_transferencia));
    const cobrado = ef + tj + tr;

    // Si lo cobrado no coincide con los ítems, la diferencia queda como descuento o recargo de ajuste.
    let total = productosTotal + delivery - descuento, recargo = 0, motivoDesc = descuento ? 'Descuento (sistema anterior)' : null, motivoRec = null;
    const devolucion = !anulada && cobrado < 0;
    if (devolucion) {
      for (const [formaId, monto] of [[FORMA.efectivo, ef], [FORMA.tarjeta, tj], [FORMA.transferencia, tr]]) if (monto < 0) devoluciones.push({ venta: v.idventa, forma: formaId, monto: -monto, cierre: caja?.cierre ?? null, fecha: caja?.fecha_emision || fechaFin, usuario });
      descuento = productosTotal + delivery; motivoDesc = descuento ? 'Devolución (sistema anterior)' : null; total = 0;
    } else if (!anulada && cobrado !== total) {
      const diff = cobrado - total; montoAjustes += Math.abs(diff);
      if (diff > 0) { recargo = diff; motivoRec = 'Ajuste de importación'; ajustesRecargo++; }
      else if (descuento - diff <= productosTotal + delivery) { descuento -= diff; motivoDesc = 'Ajuste de importación'; ajustesDescuento++; }
      else { recargo = 0; }
      total = productosTotal + delivery - descuento + recargo;
    }
    if (total < 0) { descuento += total; total = 0; }

    const entregador = tipo === 'DELIVERY' ? (courierIds.has(v.fk_identregador) ? v.fk_identregador : localCourier) : null;
    const zona = tipo === 'DELIVERY' && cliente.fk_idzona_cliente ? zonas[cliente.fk_idzona_cliente - 1] : null;
    const idmesa = tipo === 'COMER_ACA' ? mesaFor(v.nombre_mesa) : null;
    const obsVenta = clean(v.observacion) && !/^ninguna$/i.test(clean(v.observacion)) ? clean(v.observacion) : null;
    const observacion = devolucion ? [obsVenta, `Devolución de Gs. ${-cobrado} al cliente (sistema anterior), registrada como gasto`].filter(Boolean).join(' · ') : obsVenta;
    cuentas.push({ idcuenta: v.idventa, fk_idmesa: idmesa, fk_idcliente: cliente.idcliente, tipo: CUENTA[tipo], estado: 'cerrada', total: anulada ? 0 : total,
      monto_descuento: 0, monto_recargo: 0, fecha_apertura: fecha, fecha_cierre: fechaFin, cerrado_por: usuario, fecha_creado: fecha, creado_por: usuario });
    pedidos.push({ idpedido: v.idventa, fk_idmesa: idmesa, fk_idcuenta: v.idventa, fk_idcliente: cliente.idcliente, fk_identregador_delivery: entregador, tipo_entrega: tipo,
      estado: anulada ? 'cancelado' : 'pagado', monto_delivery: delivery, monto_descuento: descuento, motivo_descuento: descuento ? motivoDesc : null, monto_recargo: recargo, motivo_recargo: motivoRec,
      monto_total: total, observacion, direccion_entrega: tipo === 'DELIVERY' ? cliente.direccion : null, telefono_entrega: tipo === 'DELIVERY' ? cliente.telefono : null,
      zona_codigo: zona?.codigo ?? null, zona_nombre: zona?.nombre ?? null, fecha_confirmado: fecha, confirmado_por: usuario,
      fecha_anulado: anulada ? fechaFin : null, anulado_por: anulada ? usuario : null, motivo_anulado: anulada ? 'Anulado en el sistema anterior' : null,
      version_web: 1, fecha_creado: fecha, creado_por: usuario });
    for (const l of lines) detalles.push({ fk_idpedido: v.idventa, fk_idproducto_menu: l.fk_idproducto_menu, cantidad: l.cantidad, precio_venta: l.precio_venta, precio_compra: l.precio_compra,
      estado: 'listo', observaciones: l.obs.length ? clip(l.obs.join(' · '), 1000) : null, precio_observacion: l.precio_observacion, usa_receta_stock: false, fecha_creado: fecha, creado_por: usuario });

    if (anulada || cobrado <= 0) continue;
    // Cobros: uno por forma de pago (la tarjeta se separa en débito/crédito si el sistema anterior lo registró).
    const tarjetas = tarjetaDe.get(v.idventa) || [];
    const parts = [];
    if (ef > 0) parts.push([FORMA.efectivo, ef, null]);
    if (tr > 0) parts.push([FORMA.transferencia, tr, tarjetas.find(t => key(t.forma_pago) === 'transferencia')?.referencia || null]);
    if (tj > 0) {
      const card = tarjetas.find(t => key(t.forma_pago) === 'tarjeta');
      parts.push([card && key(card.tipo_tarjeta) === 'credito' ? FORMA.credito : card ? FORMA.debito : FORMA.tarjeta, tj, card?.referencia || null]);
    }
    const pagadoAt = caja?.fecha_emision || fechaFin;
    for (const [formaId, importe, referencia] of parts) {
      pagoId++;
      pagos.push({ idpago: pagoId, fk_idcuenta: v.idventa, fk_idpedido: null, fk_idforma_pago: formaId, importe, estado: 'aprobado', referencia: referencia ? clip(referencia, 120) : null, pagado_at: pagadoAt, fecha_creado: pagadoAt, creado_por: usuario });
      if (caja?.cierre != null) { cajaItemId++; cajaItems.push({ idcaja_item: cajaItemId, fk_idcaja_gral: caja.cierre, fk_idforma_pago: formaId, tipo_movimiento: 'ingreso', descripcion: `Cobro pedido #${v.idventa}`, monto_pago: importe, monto_gasto: 0, fk_idpago: pagoId, fk_idgasto: null, es_reversion: false, fecha_creado: pagadoAt, creado_por: usuario }); }
    }
    // Venta válida sin movimiento de caja (o cuyo movimiento no registró el delivery): ese delivery nunca se descontó
    // en un cierre; se registra como ya pagado sin caja.
    if ((!caja || Math.round(num(caja.monto_delivery)) === 0) && delivery > 0 && entregador !== null) {
      const acc = deliverySinCaja.get(entregador) || { total: 0, pedidos: [], desde: fecha, hasta: fecha }; deliverySinCaja.set(entregador, acc);
      acc.total += delivery; acc.pedidos.push({ idpedido: v.idventa, monto: delivery });
      if (fecha < acc.desde) acc.desde = fecha; if (fecha > acc.hasta) acc.hasta = fecha;
    }
    // Delivery de esa caja: el sistema anterior lo descontaba al cerrar (se le pagaba al entregador).
    const delCaja = Math.round(num(caja?.monto_delivery));
    if (caja?.cierre != null && delCaja > 0 && entregador !== null) {
      const porCaja = deliveryPorCaja.get(caja.cierre) || new Map(); deliveryPorCaja.set(caja.cierre, porCaja);
      const acc = porCaja.get(entregador) || { total: 0, pedidos: [] }; porCaja.set(entregador, acc);
      acc.total += delCaja; if (delivery > 0) acc.pedidos.push({ idpedido: v.idventa, monto: delivery });
    }
  }
  Object.assign(report.normalizado, { ventas_sin_mesa: ventasSinMesa, ventas_ajustadas_con_descuento: ajustesDescuento, ventas_ajustadas_con_recargo: ajustesRecargo, monto_total_ajustes: montoAjustes });
  report.normalizado.devoluciones = { ventas: new Set(devoluciones.map(d => d.venta)).size, monto: devoluciones.reduce((s, d) => s + d.monto, 0) };
  Object.assign(report.avisos, { ventas_sin_productos: ventasSinProductos, observaciones_sin_producto_descartadas: obsHuerfanas, ventas_validas_sin_movimiento_caja: ventasSinCobroCaja, producto_reemplazo_creado: Boolean(placeholderProduct) });

  // Gastos: tipos de la configuración + los del sistema anterior; el gasto en su caja.
  const gastoTipos = cfg.gasto_tipo.map(t => ({ ...t }));
  const tipoByName = new Map(gastoTipos.map(t => [key(t.nombre), t.idgasto_tipo]));
  let nextTipo = Math.max(0, ...gastoTipos.map(t => t.idgasto_tipo));
  for (const t of src.gastoTipos) if (!tipoByName.has(key(t.nombre))) { nextTipo++; gastoTipos.push({ ...gastoTipos[0], idgasto_tipo: nextTipo, nombre: clip(t.nombre, 100), orden: nextTipo, activo: t.activar !== false, fecha_creado: IMPORT_DATE, creado_por: ACTOR }); tipoByName.set(key(t.nombre), nextTipo); }
  if (devoluciones.length && !tipoByName.has('devolución (sistema anterior)')) { nextTipo++; gastoTipos.push({ ...gastoTipos[0], idgasto_tipo: nextTipo, nombre: 'Devolución (sistema anterior)', orden: nextTipo, activo: false, fecha_creado: IMPORT_DATE, creado_por: ACTOR }); tipoByName.set('devolución (sistema anterior)', nextTipo); }
  const tipoDelivery = tipoByName.get('pago a delivery');
  assert(tipoDelivery, 'Falta el tipo de gasto "Pago a delivery" en la configuración actual');
  const gastos = [], pagosDelivery = [], pagoDeliveryPedidos = [];
  let gastoId = Math.max(0, ...src.gastos.map(g => g.idgasto));
  for (const g of src.gastos) {
    const tipoNombre = src.gastoTipos.find(t => t.idgasto_tipo === g.fk_idgasto_tipo)?.nombre || 'Otros';
    const anulado = g.estado === 'ANULADO';
    gastos.push({ idgasto: g.idgasto, fk_idgasto_tipo: tipoByName.get(key(tipoNombre)) ?? tipoByName.get('otros'), fk_idforma_pago: FORMA.efectivo, fecha_gasto: g.fecha_emision,
      descripcion: clip(g.descripcion && !/^ninguna$/i.test(clean(g.descripcion)) ? g.descripcion : tipoNombre, 500), total_gasto: Math.round(num(g.monto_gasto)),
      estado: anulado ? 'anulado' : 'pagado', fecha_anulado: anulado ? g.fecha_emision : null, anulado_por: anulado ? who(g.fk_idusuario) : null, motivo_anulado: anulado ? 'Anulado en el sistema anterior' : null,
      fecha_creado: g.fecha_emision, creado_por: who(g.fk_idusuario) });
    const enCaja = gastoCaja.get(g.idgasto);
    if (!anulado && enCaja?.cierre != null) { cajaItemId++; cajaItems.push({ idcaja_item: cajaItemId, fk_idcaja_gral: enCaja.cierre, fk_idforma_pago: FORMA.efectivo, tipo_movimiento: 'egreso', descripcion: `Gasto #${g.idgasto}`, monto_pago: 0, monto_gasto: Math.round(num(g.monto_gasto)), fk_idpago: null, fk_idgasto: g.idgasto, es_reversion: false, fecha_creado: g.fecha_emision, creado_por: who(g.fk_idusuario) }); }
  }

  for (const d of devoluciones) {
    gastoId++;
    const desc = `Devolución venta #${d.venta} (sistema anterior)`;
    gastos.push({ idgasto: gastoId, fk_idgasto_tipo: tipoByName.get('devolución (sistema anterior)'), fk_idforma_pago: d.forma, fecha_gasto: d.fecha, descripcion: desc, total_gasto: d.monto, estado: 'pagado', fecha_anulado: null, anulado_por: null, motivo_anulado: null, fecha_creado: d.fecha, creado_por: d.usuario });
    if (d.cierre != null) { cajaItemId++; cajaItems.push({ idcaja_item: cajaItemId, fk_idcaja_gral: d.cierre, fk_idforma_pago: d.forma, tipo_movimiento: 'egreso', descripcion: desc, monto_pago: 0, monto_gasto: d.monto, fk_idpago: null, fk_idgasto: gastoId, es_reversion: false, fecha_creado: d.fecha, creado_por: d.usuario }); }
  }

  // Cajas: una por cierre del sistema anterior, con su arqueo por forma de pago.
  const cajas = [], arqueos = [], verifCajas = [];
  let contadoNegativo = 0, cajasAbiertas = 0, pdId = 0;
  const courierName = new Map(entregadores.map(e => [e.identregador_delivery, e.nombre_completo]));
  for (const cc of src.cierres) {
    const usuario = who(cc.fk_idusuario);
    const ingresos = cajaItems.filter(i => i.fk_idcaja_gral === cc.idcaja_cierre);
    const lastMov = ingresos.reduce((m, i) => (!m || i.fecha_creado > m ? i.fecha_creado : m), null);
    const abierta = cc.estado !== 'CERRADO';
    if (abierta) cajasAbiertas++;
    let fechaCierre = cc.fecha_fin && cc.fecha_fin >= cc.fecha_inicio ? cc.fecha_fin : (lastMov && lastMov >= cc.fecha_inicio ? lastMov : cc.fecha_inicio);
    cajas.push({ idcaja_gral: cc.idcaja_cierre, fecha_apertura: cc.fecha_inicio, fecha_cierre: fechaCierre, cerrado_por: abierta ? ACTOR : usuario, estado: 'cerrada', fecha_creado: cc.fecha_inicio, creado_por: usuario });
    // Pago a delivery de esa caja, por entregador.
    for (const [courier, acc] of deliveryPorCaja.get(cc.idcaja_cierre) || []) {
      gastoId++; pdId++; cajaItemId++;
      const desc = `Pago a delivery ${courierName.get(courier) || ''} · cierre de caja #${cc.idcaja_cierre} (sistema anterior)`.slice(0, 500);
      gastos.push({ idgasto: gastoId, fk_idgasto_tipo: tipoDelivery, fk_idforma_pago: FORMA.efectivo, fecha_gasto: fechaCierre, descripcion: desc, total_gasto: acc.total, estado: 'pagado', fecha_anulado: null, anulado_por: null, motivo_anulado: null, fecha_creado: fechaCierre, creado_por: usuario });
      cajaItems.push({ idcaja_item: cajaItemId, fk_idcaja_gral: cc.idcaja_cierre, fk_idforma_pago: FORMA.efectivo, tipo_movimiento: 'egreso', descripcion: desc.slice(0, 200), monto_pago: 0, monto_gasto: acc.total, fk_idpago: null, fk_idgasto: gastoId, es_reversion: false, fecha_creado: fechaCierre, creado_por: usuario });
      const desde = new Date(cc.fecha_inicio), hasta = new Date(fechaCierre);
      const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      pagosDelivery.push({ idpago_delivery: pdId, fk_identregador_delivery: courier, fecha_desde: iso(desde), fecha_hasta: iso(hasta), cantidad_pedidos: Math.max(1, acc.pedidos.length), total: acc.total,
        fk_idforma_pago: FORMA.efectivo, fk_idgasto: gastoId, sin_caja: false, observacion: null, estado: 'pagado', fecha_creado: fechaCierre, creado_por: usuario });
      for (const p of acc.pedidos) pagoDeliveryPedidos.push({ fk_idpago_delivery: pdId, fk_idpedido: p.idpedido, monto_delivery: p.monto, activo: true });
    }
    // Arqueo: efectivo con la apertura; tarjeta y transferencia se cierran por lo esperado; la diferencia queda en efectivo.
    const movs = cajaItems.filter(i => i.fk_idcaja_gral === cc.idcaja_cierre);
    const formas = new Set([FORMA.efectivo, ...movs.map(m => m.fk_idforma_pago)]);
    const apertura = Math.round(aperturas.get(cc.idcaja_cierre) || 0);
    const rows = [...formas].map(f => {
      const ing = movs.filter(m => m.fk_idforma_pago === f && m.tipo_movimiento === 'ingreso').reduce((s, m) => s + m.monto_pago + m.monto_gasto, 0);
      const egr = movs.filter(m => m.fk_idforma_pago === f && m.tipo_movimiento === 'egreso').reduce((s, m) => s + m.monto_pago + m.monto_gasto, 0);
      const inicial = f === FORMA.efectivo ? apertura : 0;
      return { fk_idforma_pago: f, monto_inicial: inicial, total_ingresos: ing, total_egresos: egr, monto_esperado: inicial + ing - egr };
    });
    const sistema = rows.reduce((s, r) => s + r.monto_esperado, 0);
    const cierreTotal = cierresMonto.has(cc.idcaja_cierre) ? Math.round(cierresMonto.get(cc.idcaja_cierre)) : null;
    const otros = rows.filter(r => r.fk_idforma_pago !== FORMA.efectivo).reduce((s, r) => s + r.monto_esperado, 0);
    for (const r of rows) {
      let contado = r.fk_idforma_pago === FORMA.efectivo ? (cierreTotal === null ? r.monto_esperado : cierreTotal - otros) : r.monto_esperado;
      if (contado < 0) { contadoNegativo++; contado = 0; }
      arqueos.push({ fk_idcaja_gral: cc.idcaja_cierre, ...r, monto_contado: contado, diferencia: contado - r.monto_esperado, creado_por: usuario });
    }
    verifCajas.push({ caja: cc.idcaja_cierre, sistema_nuevo: sistema, cierre_anterior: cierreTotal });
  }
  const isoDay = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  for (const [courier, acc] of deliverySinCaja) {
    pdId++;
    pagosDelivery.push({ idpago_delivery: pdId, fk_identregador_delivery: courier, fecha_desde: isoDay(acc.desde), fecha_hasta: isoDay(acc.hasta), cantidad_pedidos: acc.pedidos.length, total: acc.total,
      fk_idforma_pago: null, fk_idgasto: null, sin_caja: true, observacion: 'Importado: ventas sin movimiento de caja en el sistema anterior; su delivery se da por pagado', estado: 'pagado', fecha_creado: IMPORT_DATE, creado_por: ACTOR });
    for (const p of acc.pedidos) pagoDeliveryPedidos.push({ fk_idpago_delivery: pdId, fk_idpedido: p.idpedido, monto_delivery: p.monto, activo: true });
  }
  report.normalizado.delivery_sin_caja_dado_por_pagado = [...deliverySinCaja.values()].reduce((s, a) => s + a.total, 0);
  Object.assign(report.avisos, { cajas_abiertas_importadas_cerradas: cajasAbiertas, cajas_con_contado_efectivo_negativo: contadoNegativo });
  report.importado = { categorias: categorias.length, unidades: unidades.length, grupos: grupos.length, productos: productos.length, zonas: zonas.length, clientes: clientes.length,
    entregadores: entregadores.length, pedidos: pedidos.length, pedidos_pagados: pedidos.filter(p => p.estado === 'pagado').length, pedidos_anulados: pedidos.filter(p => p.estado === 'cancelado').length,
    lineas: detalles.length, pagos: pagos.length, cajas: cajas.length, movimientos_caja: cajaItems.length, gastos: gastos.length, pagos_delivery: pagosDelivery.length };

  return { categorias, unidades, grupos, productos, zonas, clientes, entregadores, sinMesaUbicacion, sinMesa, cuentas, pedidos, detalles, pagos, cajas, arqueos, cajaItems,
    gastoTipos, gastos, pagosDelivery, pagoDeliveryPedidos, report, verifCajas, FORMA };
}

// Totales esperados del sistema anterior (para comparar después de importar).
function expected(src) {
  const porAnio = {};
  let devoluciones = 0;
  const cobro = new Map();
  for (const d of src.detalles) if (/^VENTA_/.test(d.tabla_origen) && d.estado === 'EMITIDO' && !cobro.has(d.id_origen)) cobro.set(d.id_origen, num(d.monto_venta_efectivo) + num(d.monto_venta_tarjeta) + num(d.monto_venta_transferencia));
  for (const v of src.ventas) {
    if (v.estado === 'ANULADO') continue;
    const y = new Date(v.fecha_inicio).getFullYear();
    const monto = cobro.has(v.idventa) ? cobro.get(v.idventa) : num(v.monto_venta_efectivo) + num(v.monto_venta_tarjeta) + num(v.monto_venta_transferencia);
    porAnio[y] = porAnio[y] || { ventas: 0, monto: 0 }; porAnio[y].ventas++;
    if (monto >= 0) porAnio[y].monto += Math.round(monto); else devoluciones += Math.round(-monto);
  }
  return { porAnio, devoluciones, anuladas: src.ventas.filter(v => v.estado === 'ANULADO').length, clientes: src.clientes.length };
}

// ---------------------------------------------------------------- escritura
async function insertMany(c, table, rows, columns = null) {
  if (!rows.length) return;
  const cols = columns || Object.keys(rows[0]);
  const size = Math.max(1, Math.floor(30000 / cols.length));
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size), params = [];
    const values = chunk.map(r => `(${cols.map(col => { params.push(r[col] === undefined ? null : r[col]); return `$${params.length}`; }).join(',')})`);
    await c.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}`, params);
  }
}

async function createDatabase() {
  const admin = new pg.Client({ ...base, database: 'postgres', application_name: 'gorila_import_admin' });
  await admin.connect();
  try {
    const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [TARGET_DB])).rowCount;
    if (exists && !recreate) throw new Error(`La base ${TARGET_DB} ya existe. Usá --recreate para borrarla y volver a importar`);
    if (exists) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [TARGET_DB]);
      await admin.query(`DROP DATABASE "${TARGET_DB}"`);
    }
    await admin.query(`CREATE DATABASE "${TARGET_DB}" ENCODING 'UTF8' TEMPLATE template0`);
  } finally { await admin.end(); }
}

async function load(data, cfg) {
  const c = new pg.Client({ ...base, database: TARGET_DB, application_name: 'gorila_import_target' });
  await c.connect();
  let started = false;
  try {
    await c.query('BEGIN'); started = true;
    await c.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    // Carga masiva: se desactivan los disparadores (stock, caja automática, validaciones de pedido abierto);
    // la integridad se verifica al final con las claves foráneas y los totales.
    await c.query('SET LOCAL session_replication_role = replica');
    for (const t of [...CONFIG_TABLES].reverse()) await c.query(`DELETE FROM ${t}`);
    for (const t of CONFIG_TABLES) {
      const cols = (await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [t])).rows.map(r => r.column_name);
      const rows = t === 'gasto_tipo' ? data.gastoTipos : t === 'mesa' ? cfg.mesa.map(m => ({ ...m, estado: 'libre' })) : cfg[t];
      if (!rows.length) continue;
      const usable = cols.filter(col => Object.prototype.hasOwnProperty.call(rows[0], col));
      await insertMany(c, t, rows, usable);
    }
    await insertMany(c, 'ubicacion_mesa', [data.sinMesaUbicacion]);
    await insertMany(c, 'mesa', [data.sinMesa]);
    for (const [t, rows] of [['categoria_menu', data.categorias], ['unidad_menu', data.unidades], ['grupo_menu', data.grupos], ['producto_menu', data.productos],
      ['zona_cliente', data.zonas], ['cliente', data.clientes], ['entregador_delivery', data.entregadores], ['cuenta', data.cuentas], ['pedido', data.pedidos],
      ['detalle_pedido', data.detalles], ['pago', data.pagos], ['caja_gral', data.cajas], ['caja_arqueo', data.arqueos], ['gasto', data.gastos],
      ['caja_item', data.cajaItems], ['pago_delivery', data.pagosDelivery], ['pago_delivery_pedido', data.pagoDeliveryPedidos]]) {
      await insertMany(c, t, rows);
      process.stdout.write(`  ${t}: ${rows.length}\n`);
    }
    await c.query('SET LOCAL session_replication_role = origin');
    // Secuencias al siguiente número libre.
    const seqs = (await c.query(`SELECT table_name t, column_name col, substring(column_default from 'nextval\\(''([^'']+)''') seq FROM information_schema.columns WHERE table_schema='public' AND column_default LIKE 'nextval(%'`)).rows;
    for (const s of seqs) await c.query(`SELECT setval('${s.seq}', COALESCE((SELECT max(${s.col}) FROM ${s.t}), 0) + 1, false)`);
    return { c, started };
  } catch (error) { if (started) await c.query('ROLLBACK').catch(() => {}); await c.end(); throw error; }
}

async function verify(c, data, exp) {
  const problems = [];
  // Claves foráneas (los disparadores estuvieron desactivados durante la carga).
  const fks = (await c.query(`SELECT con.conname, cl.relname child, a.attname col, pcl.relname parent, pa.attname pcol FROM pg_constraint con
    JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_class pcl ON pcl.oid=con.confrelid
    JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=con.conkey[1] JOIN pg_attribute pa ON pa.attrelid=con.confrelid AND pa.attnum=con.confkey[1]
    WHERE con.contype='f' AND array_length(con.conkey,1)=1`)).rows;
  for (const fk of fks) {
    const n = (await c.query(`SELECT count(*)::int n FROM ${fk.child} x WHERE x.${fk.col} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${fk.parent} p WHERE p.${fk.pcol}=x.${fk.col})`)).rows[0].n;
    if (n) problems.push(`${fk.child}.${fk.col} → ${fk.parent}: ${n} sin referencia`);
  }
  // Ventas por año: cantidad y monto contra el sistema anterior.
  const anios = (await c.query(`SELECT extract(year FROM fecha_confirmado)::int y, count(*)::int ventas, sum(monto_total)::bigint monto FROM pedido WHERE estado='pagado' GROUP BY 1`)).rows;
  const porAnio = {};
  for (const [y, e] of Object.entries(exp.porAnio)) {
    const r = anios.find(a => a.y === Number(y)) || { ventas: 0, monto: 0 };
    porAnio[y] = { anterior: e, nuevo: { ventas: r.ventas, monto: Number(r.monto) } };
    if (r.ventas !== e.ventas || Number(r.monto) !== e.monto) problems.push(`Año ${y}: anterior ${e.ventas} ventas / ${e.monto} · nuevo ${r.ventas} / ${r.monto}`);
  }
  const anuladas = (await c.query("SELECT count(*)::int n FROM pedido WHERE estado='cancelado'")).rows[0].n;
  if (anuladas !== exp.anuladas) problems.push(`Anuladas: anterior ${exp.anuladas}, nuevo ${anuladas}`);
  const clientes = (await c.query('SELECT count(*)::int n FROM cliente')).rows[0].n;
  if (clientes !== exp.clientes) problems.push(`Clientes: anterior ${exp.clientes}, nuevo ${clientes}`);
  const dev = Number((await c.query(`SELECT COALESCE(sum(g.total_gasto),0)::bigint t FROM gasto g JOIN gasto_tipo t ON t.idgasto_tipo=g.fk_idgasto_tipo WHERE t.nombre='Devolución (sistema anterior)'`)).rows[0].t);
  if (dev !== exp.devoluciones) problems.push(`Devoluciones: anterior ${exp.devoluciones}, nuevo ${dev}`);
  // Cobros = total de los pedidos pagados.
  const [cob] = (await c.query(`SELECT (SELECT sum(importe) FROM pago WHERE estado='aprobado')::bigint pagos, (SELECT sum(monto_total) FROM pedido WHERE estado='pagado')::bigint pedidos`)).rows;
  if (cob.pagos !== cob.pedidos) problems.push(`Cobros ${cob.pagos} ≠ pedidos pagados ${cob.pedidos}`);
  // Cajas: el saldo del sistema nuevo contra el cierre anterior (apertura + ventas − gastos − delivery).
  const cajasDif = (await c.query(`SELECT count(*)::int n, count(*) FILTER (WHERE diferencia<>0)::int con_dif, sum(diferencia)::bigint dif FROM caja_arqueo`)).rows[0];
  // Delivery pendiente: debe quedar en cero (todo lo cobrado se le pagó al entregador en su caja).
  const pend = (await c.query(`SELECT count(*)::int n, COALESCE(sum(monto_delivery),0)::bigint t FROM pedido p WHERE tipo_entrega='DELIVERY' AND estado='pagado' AND monto_delivery>0 AND NOT EXISTS (SELECT 1 FROM pago_delivery_pedido x WHERE x.fk_idpedido=p.idpedido AND x.activo)`)).rows[0];
  if (pend.n) problems.push(`Delivery pendiente: ${pend.n} pedidos por ${pend.t}`);
  return { problems, porAnio, cobros: cob, arqueos: cajasDif, delivery_pendiente: pend };
}

// ---------------------------------------------------------------- principal
try {
  console.log(`Origen: ${SOURCE_DB} (solo lectura) · Configuración: ${CONFIG_DB} (solo lectura) · Destino: ${TARGET_DB}`);
  const [src, cfg] = await Promise.all([readSource(), readConfig()]);
  const data = prepare(src, cfg);
  const exp = expected(src);
  console.log('Preparado:', JSON.stringify(data.report.importado));
  console.log('Normalizado:', JSON.stringify(data.report.normalizado));
  console.log('Avisos:', JSON.stringify(data.report.avisos));
  const report = { ...data.report, esperado: exp, generado: new Date().toISOString(), origen_db: SOURCE_DB, destino_db: TARGET_DB, modo: apply ? 'apply' : 'dry-run' };
  if (!apply) {
    await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Simulación: no se modificó ninguna base. Informe: ${REPORT}`);
  } else {
    await createDatabase();
    console.log(`Base ${TARGET_DB} creada. Cargando…`);
    const { c } = await load(data, cfg);
    try {
      const check = await verify(c, data, exp);
      report.verificacion = check;
      if (check.problems.length) {
        await c.query('ROLLBACK');
        console.error('Verificación fallida; no se confirmó nada:\n - ' + check.problems.slice(0, 30).join('\n - '));
        process.exitCode = 1;
      } else {
        await c.query('COMMIT');
        console.log('Importación confirmada y verificada:', JSON.stringify({ porAnio: check.porAnio, cobros: check.cobros, arqueos: check.arqueos, delivery_pendiente: check.delivery_pendiente }));
      }
    } finally { await c.end(); }
    await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Informe: ${REPORT}`);
  }
} catch (error) {
  console.error('Importación cancelada:', error.message);
  process.exitCode = 1;
}
