import 'dotenv/config';
import pg from 'pg';
import { readFile, writeFile } from 'node:fs/promises';
import { importIngredientes, prepareIngredientes, readIngredientes } from './gorila-ingredientes.js';

// Importa el catálogo y los clientes del sistema anterior de Hamburgus (SisDaoSamu3, backup
// bdhamburgusA_2026-11-19.backup restaurado como bdhamburgus_origen) a una base NUEVA (por defecto
// bdrestaurante_hamburgus). NO importa ventas, cajas ni gastos. Los clientes repetidos (mismo teléfono
// o mismo RUC real) se unifican en uno solo. La base de configuración (CONFIG_DB) solo se lee: de ella
// se copian usuarios, roles, permisos, formas de pago, mesas, comanda y datos del restaurante.
//
//   node db/migrate-hamburgus.js --dry-run            prepara todo en memoria e informa (no escribe nada)
//   node db/migrate-hamburgus.js --apply              crea la base nueva, importa y verifica (todo o nada)
//   node db/migrate-hamburgus.js --apply --recreate   borra y vuelve a crear la base nueva

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const recreate = args.includes('--recreate');
for (const a of args) if (!['--apply', '--dry-run', '--recreate'].includes(a) && !a.startsWith('--target=') && !a.startsWith('--report=')) throw new Error(`Opción desconocida: ${a}`);
const opt = name => (args.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];

const SOURCE_DB = process.env.HAMBURGUS_SOURCE_DB || 'bdhamburgus_origen';
const CONFIG_DB = process.env.HAMBURGUS_CONFIG_DB || 'bdrestaurante_web';
const TARGET_DB = opt('target') || process.env.HAMBURGUS_TARGET_DB || 'bdrestaurante_hamburgus';
const REPORT = opt('report') || '../hamburgus-import-report.json';
if (!/^(bdrestaurante_hamburgus|hamburgus_test_)[a-z0-9_]*$/.test(TARGET_DB)) throw new Error('La base destino debe llamarse bdrestaurante_hamburgus… o hamburgus_test_…');
if ([SOURCE_DB, CONFIG_DB].includes(TARGET_DB)) throw new Error('La base destino no puede ser el origen ni la de configuración');
const ACTOR = 'MIGRACION_HAMBURGUS';
const IMPORT_DATE = new Date();
const base = { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '' };

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const clean = v => String(v ?? '').trim().replace(/\s+/g, ' ');
const key = v => clean(v).toLowerCase();
const num = v => Number(v || 0);
const clip = (v, n) => { const s = clean(v); return s.length > n ? s.slice(0, n) : s; };
// Teléfono normalizado: solo dígitos, +595 → 0. Los de relleno ("0000", "123"…) quedan vacíos.
const normPhone = v => {
  let d = String(v ?? '').replace(/\D/g, '');
  if (/^595\d{8,}$/.test(d)) d = `0${d.slice(3)}`;
  return d.length < 6 || /^0+$/.test(d) ? null : d;
};
// RUC de relleno del sistema anterior ("44444401", "123456", "1111", ".", "0"…): queda vacío.
const normRuc = v => {
  const s = clean(v), d = s.replace(/\D/g, '');
  return !s || /^4444440/.test(s) || d.length < 5 || /^(\d)\1+$/.test(d) || '1234567890'.includes(d.slice(0, 6)) ? null : s;
};
const normDir = v => { const s = clean(v); return !s || /^(sin direcci[oó]n|\.+|-+|ninguna)$/i.test(s) ? null : s; };
// RUC que en el sistema anterior se usaron para facturar a varias personas: no sirven para unificar.
const RUC_COMPARTIDO = new Set(['2236733-0']);
const isOcasionalName =v => /^(cliente )?oca[sc]ional$/i.test(clean(v));
// "mesa 3", "cliente 13" y las copias de "ocasional": clientes de relleno.
const isJunkName = v => /^(mesa|cliente)\s*\d+$/i.test(clean(v)) || isOcasionalName(v);

// ---------------------------------------------------------------- lectura
async function readSource() {
  const c = new pg.Client({ ...base, database: SOURCE_DB, application_name: 'hamburgus_import_source' });
  await c.connect();
  await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const q = async sql => (await c.query(sql)).rows;
  try {
    return {
      categorias: await q('SELECT * FROM producto_categoria ORDER BY idproducto_categoria'),
      unidades: await q('SELECT * FROM producto_unidad ORDER BY idproducto_unidad'),
      grupos: await q('SELECT * FROM producto_grupo ORDER BY idproducto_grupo'),
      productos: await q('SELECT * FROM producto ORDER BY idproducto'),
      zonas: await q('SELECT * FROM zona_delivery ORDER BY idzona_delivery'),
      clientes: await q('SELECT * FROM cliente ORDER BY idcliente'),
      entregadores: await q('SELECT * FROM entregador ORDER BY identregador'),
      ingredientesProducto: await readIngredientes(c)
    };
  } finally { await c.query('ROLLBACK'); await c.end(); }
}

const CONFIG_TABLES = ['usuario_rol', 'usuario_rol_evento', 'usuario_rol_item', 'usuario', 'forma_pago', 'ubicacion_mesa', 'mesa',
  'datos_restaurante', 'comanda_config', 'comanda_color', 'gasto_tipo', 'unidad_medida', 'unidad_conversion', 'cargo_personal'];

async function readConfig() {
  const c = new pg.Client({ ...base, database: CONFIG_DB, application_name: 'hamburgus_import_config' });
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
function prepareCatalog(src, report) {
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

  // Zonas: se unifican las de igual nombre.
  const zonaByName = new Map(), zonaMap = new Map(), zonas = [];
  for (const z of src.zonas) {
    const k = key(z.nombre) || `zona ${z.idzona_delivery}`;
    if (!zonaByName.has(k)) { const row = { idzona_cliente: zonas.length + 1, codigo: `HAM-${z.idzona_delivery}`, nombre: clip(z.nombre, 100) || `Zona ${z.idzona_delivery}`, precio_delivery: Math.max(0, Math.round(num(z.delivery))), activo: true, creado_por: ACTOR }; zonas.push(row); zonaByName.set(k, row); }
    zonaMap.set(z.idzona_delivery, zonaByName.get(k));
  }
  report.normalizado.zonas_unificadas = src.zonas.length - zonas.length;

  const entregadores = src.entregadores.map(e => ({ identregador_delivery: e.identregador, nombre_completo: clip(e.nombre, 120) || `Entregador ${e.identregador}`, activo: e.activar !== false, creado_por: ACTOR }));
  return { categorias, unidades, grupos, productos, zonas, zonaMap, entregadores };
}

// Clientes: se descartan los "mesa N"/"cliente N" sin teléfono; los que comparten teléfono o RUC real se unifican.
function prepareClientes(src, zonaMap, report) {
  const ocasional = src.clientes.find(c => c.idcliente === 1 && isOcasionalName(c.nombre));
  assert(ocasional, 'No se encontró el cliente ocasional (id 1) en el origen');
  const rows = [], descartados = [];
  for (const cl of src.clientes) {
    const r = { src: cl, id: cl.idcliente, nombre: clip(cl.nombre, 120), telefono: normPhone(cl.telefono), ruc: normRuc(cl.ruc), direccion: normDir(cl.direccion),
      zona: zonaMap.get(cl.fk_idzona_delivery)?.idzona_cliente ?? null, ultimo: cl.fecha_cumple || cl.fecha_inicio, alta: cl.fecha_inicio };
    if (cl !== ocasional && !r.telefono && isJunkName(cl.nombre)) { descartados.push(cl.idcliente); continue; }
    rows.push(r);
  }

  // RUC prestados (se usaron para facturar a otras personas): solo los conserva el cliente cuyo nombre
  // más se repite entre los que lo tienen; esos clientes solo se unen por teléfono con los de igual nombre.
  for (const ruc of RUC_COMPARTIDO) {
    const holders = rows.filter(r => r.ruc && key(r.ruc) === key(ruc));
    const freq = new Map(); for (const h of holders) freq.set(key(h.nombre), (freq.get(key(h.nombre)) || 0) + 1);
    const owner = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0];
    for (const h of holders) {
      h.restringido = true;
      if (key(h.nombre) !== owner) { h.nota = `Facturaba con el RUC ${h.ruc} de otro cliente (sistema anterior)`; h.ruc = null; }
    }
  }
  const rowById = new Map(rows.map(r => [r.id, r]));

  // Union-find por teléfono y RUC (el ocasional nunca se une con nadie).
  const parent = new Map(rows.map(r => [r.id, r.id]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const byPhone = new Map(), byRuc = new Map();
  for (const r of rows) {
    if (ocasional && r.id === ocasional.idcliente) continue;
    if (r.telefono) {
      const prev = byPhone.get(r.telefono);
      if (prev === undefined) byPhone.set(r.telefono, r.id);
      else if (!((r.restringido || rowById.get(prev).restringido) && key(r.nombre) !== key(rowById.get(prev).nombre))) union(prev, r.id);
    }
    const rk = r.ruc && key(r.ruc);
    if (rk) { if (byRuc.has(rk)) union(byRuc.get(rk), r.id); else byRuc.set(rk, r.id); }
  }
  const groups = new Map();
  for (const r of rows) { const g = find(r.id); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }

  const clientes = [], unificados = [];
  const time = d => (d ? new Date(d).getTime() : 0);
  for (const members of groups.values()) {
    // Sobrevive el de uso más reciente; a igualdad, el de ID mayor.
    members.sort((a, b) => time(b.ultimo) - time(a.ultimo) || b.id - a.id);
    const s = members[0], otros = members.slice(1);
    const pick = f => s[f] ?? otros.find(o => o[f])?.[f] ?? null;
    const alta = members.reduce((m, r) => (r.alta && (!m || time(r.alta) < time(m)) ? r.alta : m), null);
    // En notas queda cada absorbido con su nombre, teléfono y RUC, para que no se pierda nada.
    const notas = [...new Set(members.map(m => m.nota).filter(Boolean)),
      otros.length && `Unificado (sistema anterior) de: ${otros.map(o => [`#${o.id} ${o.nombre}`, o.telefono && `tel. ${o.telefono}`, o.ruc && `RUC ${o.ruc}`].filter(Boolean).join(' ')).join(' · ')}`].filter(Boolean).join(' · ') || null;
    clientes.push({ _ultimo: time(s.ultimo), idcliente: s.id, nombre_completo: s.id === ocasional.idcliente ? 'OCASIONAL' : s.nombre || otros.find(o => o.nombre)?.nombre || `Cliente ${s.id}`, ruc: pick('ruc') ? clip(pick('ruc'), 30) : null,
      telefono: pick('telefono') ? clip(pick('telefono'), 40) : null, direccion: pick('direccion') ? clip(pick('direccion'), 250) : null, notas, activo: true,
      es_ocacional: Boolean(ocasional && s.id === ocasional.idcliente), fk_idzona_cliente: pick('zona'), fecha_creado: alta || IMPORT_DATE, creado_por: ACTOR });
    if (otros.length) {
      const nombres = [...new Set(members.map(m => key(m.nombre)))];
      unificados.push({ queda: s.id, absorbidos: otros.map(o => o.id), telefono: pick('telefono'), ruc: pick('ruc'), nombres: members.map(m => `#${m.id} ${m.nombre}`), nombres_distintos: nombres.length > 1 });
    }
  }
  // Teléfono que quedó en dos clientes separados (por un RUC prestado): lo conserva el de uso más reciente.
  const telOwner = new Map();
  for (const c of [...clientes].sort((a, b) => b._ultimo - a._ultimo || b.idcliente - a.idcliente)) {
    if (!c.telefono) continue;
    if (!telOwner.has(c.telefono)) { telOwner.set(c.telefono, c.idcliente); continue; }
    c.notas = [c.notas, `Tel. ${c.telefono} compartido con el cliente #${telOwner.get(c.telefono)} (sistema anterior)`].filter(Boolean).join(' · ');
    c.telefono = null;
  }
  for (const c of clientes) delete c._ultimo;
  clientes.sort((a, b) => a.idcliente - b.idcliente);
  // Un mismo teléfono/RUC no puede quedar en dos clientes (índices únicos del esquema).
  for (const f of ['telefono', 'ruc']) { const seen = new Set(); for (const c of clientes) { const v = c[f] && key(c[f]); if (!v) continue; assert(!seen.has(v), `${f} repetido después de unificar: ${v}`); seen.add(v); } }

  const absorbidos = unificados.reduce((s, u) => s + u.absorbidos.length, 0);
  Object.assign(report.normalizado, { clientes_descartados_mesa_cliente_N: descartados.length, clientes_grupos_unificados: unificados.length, clientes_absorbidos: absorbidos,
    clientes_con_telefono: clientes.filter(c => c.telefono).length, clientes_con_ruc: clientes.filter(c => c.ruc).length });
  report.clientes_unificados_nombres_distintos = unificados.filter(u => u.nombres_distintos);
  report.clientes_unificados = unificados;
  report.clientes_descartados = descartados;
  return { clientes, esperado: src.clientes.length - descartados.length - absorbidos };
}

function prepare(src) {
  const report = { origen: {}, importado: {}, normalizado: {} };
  for (const [k, v] of Object.entries(src)) if (Array.isArray(v)) report.origen[k] = v.length;
  const cat = prepareCatalog(src, report);
  const cli = prepareClientes(src, cat.zonaMap, report);
  report.importado = { categorias: cat.categorias.length, unidades: cat.unidades.length, grupos: cat.grupos.length, productos: cat.productos.length, zonas: cat.zonas.length,
    clientes: cli.clientes.length, entregadores: cat.entregadores.length };
  return { ...cat, clientes: cli.clientes, clientesEsperados: cli.esperado, report, ingredientesProducto: prepareIngredientes(src.ingredientesProducto) };
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
  const admin = new pg.Client({ ...base, database: 'postgres', application_name: 'hamburgus_import_admin' });
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
  const c = new pg.Client({ ...base, database: TARGET_DB, application_name: 'hamburgus_import_target' });
  await c.connect();
  let started = false;
  try {
    await c.query('BEGIN'); started = true;
    await c.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    // Carga masiva sin disparadores; la integridad se verifica al final con las claves foráneas.
    await c.query('SET LOCAL session_replication_role = replica');
    for (const t of [...CONFIG_TABLES].reverse()) await c.query(`DELETE FROM ${t}`);
    for (const t of CONFIG_TABLES) {
      const cols = (await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [t])).rows.map(r => r.column_name);
      const rows = t === 'mesa' ? cfg.mesa.map(m => ({ ...m, estado: 'libre' })) : cfg[t];
      if (!rows.length) continue;
      const usable = cols.filter(col => Object.prototype.hasOwnProperty.call(rows[0], col));
      await insertMany(c, t, rows, usable);
    }
    for (const [t, rows] of [['categoria_menu', data.categorias], ['unidad_menu', data.unidades], ['grupo_menu', data.grupos], ['producto_menu', data.productos],
      ['zona_cliente', data.zonas], ['cliente', data.clientes], ['entregador_delivery', data.entregadores]]) {
      await insertMany(c, t, rows);
      process.stdout.write(`  ${t}: ${rows.length}\n`);
    }
    await c.query('SET LOCAL session_replication_role = origin');
    const seqs = (await c.query(`SELECT table_name t, column_name col, substring(column_default from 'nextval\\(''([^'']+)''') seq FROM information_schema.columns WHERE table_schema='public' AND column_default LIKE 'nextval(%'`)).rows;
    for (const s of seqs) await c.query(`SELECT setval('${s.seq}', COALESCE((SELECT max(${s.col}) FROM ${s.t}), 0) + 1, false)`);
    process.stdout.write(`  ingredientes: ${JSON.stringify(await importIngredientes(c, data.ingredientesProducto, ACTOR))}\n`);
    return c;
  } catch (error) { if (started) await c.query('ROLLBACK').catch(() => {}); await c.end(); throw error; }
}

async function verify(c, data) {
  const problems = [];
  const fks = (await c.query(`SELECT con.conname, cl.relname child, a.attname col, pcl.relname parent, pa.attname pcol FROM pg_constraint con
    JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_class pcl ON pcl.oid=con.confrelid
    JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=con.conkey[1] JOIN pg_attribute pa ON pa.attrelid=con.confrelid AND pa.attnum=con.confkey[1]
    WHERE con.contype='f' AND array_length(con.conkey,1)=1`)).rows;
  for (const fk of fks) {
    const n = (await c.query(`SELECT count(*)::int n FROM ${fk.child} x WHERE x.${fk.col} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${fk.parent} p WHERE p.${fk.pcol}=x.${fk.col})`)).rows[0].n;
    if (n) problems.push(`${fk.child}.${fk.col} → ${fk.parent}: ${n} sin referencia`);
  }
  const count = async t => (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
  const conteos = {};
  for (const [t, esperado] of [['categoria_menu', data.categorias.length], ['unidad_menu', data.unidades.length], ['grupo_menu', data.grupos.length], ['producto_menu', data.productos.length],
    ['zona_cliente', data.zonas.length], ['cliente', data.clientesEsperados], ['entregador_delivery', data.entregadores.length],
    ['pedido', 0], ['cuenta', 0], ['pago', 0], ['caja_gral', 0], ['caja_item', 0], ['gasto', 0], ['pago_delivery', 0]]) {
    const n = await count(t); conteos[t] = n;
    if (n !== esperado) problems.push(`${t}: esperado ${esperado}, quedó ${n}`);
  }
  const dupTel = (await c.query('SELECT count(*)::int n FROM (SELECT telefono FROM cliente WHERE telefono IS NOT NULL GROUP BY 1 HAVING count(*)>1) x')).rows[0].n;
  const dupRuc = (await c.query('SELECT count(*)::int n FROM (SELECT lower(btrim(ruc)) FROM cliente WHERE ruc IS NOT NULL GROUP BY 1 HAVING count(*)>1) x')).rows[0].n;
  if (dupTel) problems.push(`Teléfonos repetidos: ${dupTel}`);
  if (dupRuc) problems.push(`RUC repetidos: ${dupRuc}`);
  return { problems, conteos };
}

// ---------------------------------------------------------------- principal
try {
  console.log(`Origen: ${SOURCE_DB} (solo lectura) · Configuración: ${CONFIG_DB} (solo lectura) · Destino: ${TARGET_DB}`);
  const [src, cfg] = await Promise.all([readSource(), readConfig()]);
  const data = prepare(src);
  console.log('Preparado:', JSON.stringify(data.report.importado));
  console.log('Normalizado:', JSON.stringify(data.report.normalizado));
  console.log(`Grupos unificados con nombres distintos: ${data.report.clientes_unificados_nombres_distintos.length}`);
  const report = { ...data.report, generado: new Date().toISOString(), origen_db: SOURCE_DB, config_db: CONFIG_DB, destino_db: TARGET_DB, modo: apply ? 'apply' : 'dry-run' };
  if (!apply) {
    await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Simulación: no se modificó ninguna base. Informe: ${REPORT}`);
  } else {
    await createDatabase();
    console.log(`Base ${TARGET_DB} creada. Cargando…`);
    const c = await load(data, cfg);
    try {
      const check = await verify(c, data);
      report.verificacion = check;
      if (check.problems.length) {
        await c.query('ROLLBACK');
        console.error('Verificación fallida; no se confirmó nada:\n - ' + check.problems.slice(0, 30).join('\n - '));
        process.exitCode = 1;
      } else {
        await c.query('COMMIT');
        console.log('Importación confirmada y verificada:', JSON.stringify(check.conteos));
      }
    } finally { await c.end(); }
    await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Informe: ${REPORT}`);
  }
} catch (error) {
  console.error('Importación cancelada:', error.message);
  process.exitCode = 1;
}
