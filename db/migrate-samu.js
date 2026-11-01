import 'dotenv/config';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const apply = process.argv.includes('--apply');
if (process.argv.length > 3 || (process.argv[2] && !['--apply', '--dry-run'].includes(process.argv[2]))) {
  throw new Error('Uso: node db/migrate-samu.js [--dry-run|--apply]');
}

const sourceName = process.env.SAMU_SOURCE_DB || 'bdsamu_8';
const productionTargetName = process.env.DB_NAME || 'bdrestaurante_web';
const targetName = process.env.SAMU_TARGET_DB || productionTargetName;
if (targetName !== productionTargetName && !targetName.startsWith('samu_test_')) throw new Error('El destino de ensayo debe comenzar con samu_test_');
if (sourceName === targetName) throw new Error('El origen y el destino no pueden coincidir');
const base = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || ''
};

const transactionTables = [
  'caja_arqueo', 'caja_gral', 'caja_item', 'categoria_menu', 'cliente', 'compra',
  'cuenta', 'detalle_compra', 'detalle_compra_producto', 'detalle_pedido',
  'detalle_pedido_ingrediente', 'detalle_pedido_receta', 'devolucion_pago', 'gasto',
  'grupo_menu', 'movimiento_stock', 'movimiento_stock_producto', 'operacion_web',
  'pago', 'pedido', 'producto_menu', 'receta', 'unidad_menu', 'vale'
];
const normalize = (value) => String(value ?? '').trim();
const nameKey = (value) => normalize(value).toLowerCase();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyBackups() {
  const folder = process.env.SAMU_BACKUP_DIR;
  assert(folder, 'Definí SAMU_BACKUP_DIR con los respaldos verificados antes de aplicar');
  const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
  assert(manifest.sourceName === 'bdsamu_8' && manifest.targetName === productionTargetName, 'El manifiesto no corresponde a estas bases');
  assert(sourceName !== 'bdsamu_8' && sourceName.startsWith('samu_stage_'), 'Aplicá la migración desde una copia restaurada del respaldo');
  for (const name of [manifest.sourceName, manifest.targetName]) {
    const archive = manifest.archives[name];
    assert(archive?.file && await sha256(archive.file) === archive.sha256, `Respaldo inválido: ${name}`);
  }
  return folder;
}

function prepare({ categories, units, groups, products, zones, clients, existingZones }) {
  const categoryIds = new Set(categories.map((row) => row.idproducto_categoria));
  const unitIds = new Set(units.map((row) => row.idproducto_unidad));
  const groupIds = new Set(groups.map((row) => row.idproducto_grupo));
  for (const [label, rows] of [['categoría', categories], ['unidad', units], ['grupo', groups], ['zona', zones]]) {
    assert(rows.every((row) => normalize(row.nombre)), `Hay ${label} sin nombre`);
  }

  const existingNames = new Set(existingZones.map((row) => nameKey(row.nombre)));
  const canonicalZones = new Map();
  const zoneMap = new Map();
  for (const zone of zones) {
    const key = nameKey(zone.nombre);
    assert(!existingNames.has(key), `Una zona del origen coincide con una zona actual: ID ${zone.idzona_delivery}`);
    if (!canonicalZones.has(key)) canonicalZones.set(key, zone);
    zoneMap.set(zone.idzona_delivery, canonicalZones.get(key).idzona_delivery);
  }
  const selectedZones = [...canonicalZones.values()];

  const normalizedProducts = products.map((product) => {
    assert(categoryIds.has(product.fk_idproducto_categoria), `Producto ${product.idproducto}: categoría inexistente`);
    assert(unitIds.has(product.fk_idproducto_unidad), `Producto ${product.idproducto}: unidad inexistente`);
    assert(groupIds.has(product.fk_idproducto_grupo), `Producto ${product.idproducto}: grupo inexistente`);
    const cleanName = normalize(product.nombre).replace(/ \[SAMU [0-9]+\]$/, '');
    assert(cleanName && cleanName.length <= 120, `Producto ${product.idproducto}: nombre incompatible`);
    assert(Number(product.precio_venta) >= 0 && Number(product.precio_compra) >= 0, `Producto ${product.idproducto}: precio negativo`);
    assert(Number.isInteger(Number(product.orden)) && Number(product.orden) >= 0 && Number(product.orden) <= 32767, `Producto ${product.idproducto}: orden incompatible`);
    return { ...product, nombre: cleanName, stock_actual: Math.max(0, Number(product.stock)) };
  });

  const rucCounts = new Map();
  const phoneCounts = new Map();
  for (const client of clients) {
    const ruc = nameKey(client.ruc);
    const phone = normalize(client.telefono);
    rucCounts.set(ruc, (rucCounts.get(ruc) || 0) + 1);
    phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1);
  }
  const excluded = { missingRuc: 0, missingPhone: 0, missingAddress: 0, duplicateRuc: 0, duplicatePhone: 0, missingZone: 0 };
  const excludedClientIds = [];
  const selectedClients = [];
  for (const client of clients) {
    const ruc = normalize(client.ruc);
    const phone = normalize(client.telefono);
    const address = normalize(client.direccion);
    const reason = !ruc ? 'missingRuc' : !phone ? 'missingPhone' : !address ? 'missingAddress'
      : rucCounts.get(ruc.toLowerCase()) !== 1 ? 'duplicateRuc' : phoneCounts.get(phone) !== 1 ? 'duplicatePhone'
      : !zoneMap.has(client.fk_idzona_delivery) ? 'missingZone' : null;
    if (reason) { excluded[reason]++; excludedClientIds.push(client.idcliente); continue; }
    assert(normalize(client.nombre) && normalize(client.nombre).length <= 120, `Cliente ${client.idcliente}: nombre incompatible`);
    assert(ruc.length <= 30 && phone.length <= 40 && address.length <= 250, `Cliente ${client.idcliente}: campo demasiado largo`);
    selectedClients.push({ ...client, nombre_completo: normalize(client.nombre), ruc, telefono: phone, direccion: address });
  }

  assert(categories.length === 11 && units.length === 25 && groups.length === 2, 'Cambió el catálogo de origen; revisá el plan');
  assert(products.length === 165 && selectedZones.length === 51 && selectedClients.length === 28, 'Cambiaron los datos de origen; revisá el informe antes de aplicar');
  assert(normalizedProducts.length === 165, 'No se prepararon todos los productos');

  return {
    categories, units, groups, products: normalizedProducts, zones: selectedZones,
    zoneMap, clients: selectedClients,
    report: {
      source: { categories: categories.length, units: units.length, groups: groups.length, products: products.length, zones: zones.length, clients: clients.length },
      planned: { categories: categories.length, units: units.length, groups: groups.length, products: normalizedProducts.length, zones: selectedZones.length, clients: selectedClients.length },
      normalized: { renamedProductIds: [], negativeStockProductIds: products.filter((row) => Number(row.stock) < 0).map((row) => row.idproducto), mergedZones: [...zoneMap].filter(([id, canonical]) => id !== canonical).map(([id, canonical]) => ({ sourceId: id, canonicalId: canonical })) },
      excludedClients: { reasons: excluded, ids: excludedClientIds }
    }
  };
}

async function restartSequence(client, sequence, rows, idColumn) {
  const next = Math.max(0, ...rows.map((row) => Number(row[idColumn]))) + 1;
  await client.query(`ALTER SEQUENCE ${sequence} RESTART WITH ${next}`);
}

async function insertRows(client, sql, rows, values) {
  for (const row of rows) await client.query(sql, values(row));
}

let source;
let target;
let targetStarted = false;
let sourceStarted = false;
let committed = false;
try {
  const backupFolder = apply ? await verifyBackups() : null;
  source = new pg.Client({ ...base, database: sourceName, application_name: 'samu_migration_source' });
  target = new pg.Client({ ...base, database: targetName, application_name: 'samu_migration_target' });
  await source.connect();
  await target.connect();
  await source.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  sourceStarted = true;
  const categories = await source.query('SELECT * FROM producto_categoria ORDER BY idproducto_categoria');
  const units = await source.query('SELECT * FROM producto_unidad ORDER BY idproducto_unidad');
  const groups = await source.query('SELECT * FROM producto_grupo ORDER BY idproducto_grupo');
  const products = await source.query('SELECT * FROM producto ORDER BY idproducto');
  const zones = await source.query('SELECT * FROM zona_delivery ORDER BY idzona_delivery');
  const clients = await source.query('SELECT * FROM cliente ORDER BY idcliente');
  const existingZones = await target.query('SELECT idzona_cliente,nombre FROM zona_cliente ORDER BY idzona_cliente');
  const data = prepare({
    categories: categories.rows, units: units.rows, groups: groups.rows,
    products: products.rows, zones: zones.rows, clients: clients.rows,
    existingZones: existingZones.rows
  });
  console.log('Preflight:', JSON.stringify({ source: data.report.source, planned: data.report.planned, excludedClients: data.report.excludedClients.reasons, normalized: { renamedProducts: data.report.normalized.renamedProductIds.length, negativeStock: data.report.normalized.negativeStockProductIds.length, mergedZones: data.report.normalized.mergedZones.length } }));
  if (!apply) {
    if (process.env.SAMU_BACKUP_DIR) {
      await writeFile(path.join(process.env.SAMU_BACKUP_DIR, 'preflight-report.json'), `${JSON.stringify({ ...data.report, generatedAt: new Date().toISOString(), sourceDatabase: sourceName, targetDatabase: targetName }, null, 2)}\n`, 'utf8');
    }
    console.log('Simulación: no se modificó ninguna base.');
  }
  else {
    const active = await target.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle'");
    assert(active.rows[0].n === 0, 'Hay otra sesión activa en el destino; detené las escrituras');
    await target.query('BEGIN');
    targetStarted = true;
    await target.query("SET LOCAL lock_timeout = '10s'");
    await target.query("SET LOCAL statement_timeout = '5min'");
    const closure = await target.query("SELECT conrelid::regclass::text AS child,confrelid::regclass::text AS parent FROM pg_constraint WHERE contype='f'");
    for (const edge of closure.rows) assert(!transactionTables.includes(edge.parent) || transactionTables.includes(edge.child), `La limpieza afectaría otra tabla: ${edge.child}`);
    const preserved = {};
    for (const table of ['usuario', 'mesa', 'forma_pago', 'zona_cliente', 'ingrediente']) {
      preserved[table] = Number((await target.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
    }
    const before = {};
    for (const table of transactionTables) before[table] = Number((await target.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);

    await target.query(`TRUNCATE TABLE ${transactionTables.join(', ')} RESTART IDENTITY`);
    await target.query('ALTER TABLE producto_menu DROP CONSTRAINT IF EXISTS producto_menu_categoria_nombre_unico');
    await target.query("UPDATE mesa SET estado='libre' WHERE estado<>'libre'");

    const zoneIdMap = new Map();
    let zoneId = Math.max(0, ...existingZones.rows.map((row) => row.idzona_cliente));
    for (const zone of data.zones) {
      zoneId++;
      zoneIdMap.set(zone.idzona_delivery, zoneId);
      await target.query('INSERT INTO zona_cliente(idzona_cliente,codigo,nombre,precio_delivery,activo,creado_por) VALUES($1,$2,$3,$4,true,$5)', [zoneId, `SAMU-${zone.idzona_delivery}`, normalize(zone.nombre), zone.delivery, 'MIGRACION_SAMU']);
    }
    for (const [oldId, canonicalId] of data.zoneMap) zoneIdMap.set(oldId, zoneIdMap.get(canonicalId));

    await insertRows(target, 'INSERT INTO categoria_menu(idcategoria_menu,nombre,orden,activa,creado_por) VALUES($1,$2,$3,$4,$5)', data.categories,
      (row) => [row.idproducto_categoria, normalize(row.nombre), row.orden, row.activar, 'MIGRACION_SAMU']);
    await insertRows(target, 'INSERT INTO unidad_menu(idunidad_menu,nombre,orden,activo,creado_por) VALUES($1,$2,$3,true,$4)', data.units,
      (row) => [row.idproducto_unidad, normalize(row.nombre), data.units.indexOf(row) + 1, 'MIGRACION_SAMU']);
    await insertRows(target, 'INSERT INTO grupo_menu(idgrupo_menu,nombre,orden,activo,creado_por) VALUES($1,$2,$3,true,$4)', data.groups,
      (row) => [row.idproducto_grupo, normalize(row.nombre), data.groups.indexOf(row) + 1, 'MIGRACION_SAMU']);
    await insertRows(target, `INSERT INTO producto_menu(idproducto_menu,fk_idcategoria_menu,fk_idunidad_menu,fk_idgrupo_menu,nombre,precio_venta,precio_compra,orden,stock_actual,stock_minimo,activo,es_descontar_stock,es_cocina,es_vender,es_comprar,creado_por)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,$15)`, data.products,
      (row) => [row.idproducto, row.fk_idproducto_categoria, row.fk_idproducto_unidad, row.fk_idproducto_grupo, row.nombre, row.precio_venta, row.precio_compra, row.orden, row.stock_actual, row.activar, row.descontar_stock, row.cocina, row.vender, row.comprar, 'MIGRACION_SAMU']);
    await insertRows(target, 'INSERT INTO cliente(idcliente,nombre_completo,ruc,direccion,telefono,fk_idzona_cliente,activo,creado_por) VALUES($1,$2,$3,$4,$5,$6,true,$7)', data.clients,
      (row) => [row.idcliente, row.nombre_completo, row.ruc, row.direccion, row.telefono, zoneIdMap.get(row.fk_idzona_delivery), 'MIGRACION_SAMU']);

    await target.query('ALTER TABLE cliente ALTER COLUMN ruc SET NOT NULL, ALTER COLUMN telefono SET NOT NULL');
    for (const [name, column] of [['cliente_ruc_no_vacio', 'ruc'], ['cliente_telefono_no_vacio', 'telefono']]) {
      const exists = await target.query('SELECT 1 FROM pg_constraint WHERE conname=$1', [name]);
      if (!exists.rowCount) await target.query(`ALTER TABLE cliente ADD CONSTRAINT ${name} CHECK (btrim(${column}) <> '')`);
    }
    for (const [name, expression] of [['cliente_ruc_normalizado_unico', 'lower(btrim(ruc))'], ['cliente_telefono_normalizado_unico', 'btrim(telefono)']]) {
      const exists = await target.query('SELECT 1 FROM pg_class WHERE relname=$1', [name]);
      if (!exists.rowCount) await target.query(`CREATE UNIQUE INDEX ${name} ON cliente (${expression})`);
    }

    for (const [sequence, rows, key] of [
      ['zona_cliente_id_seq', [{ idzona_cliente: zoneId }], 'idzona_cliente'],
      ['categoria_menu_id_seq', data.categories, 'idproducto_categoria'],
      ['unidad_menu_id_seq', data.units, 'idproducto_unidad'],
      ['grupo_menu_id_seq', data.groups, 'idproducto_grupo'],
      ['producto_menu_id_seq', data.products, 'idproducto'],
      ['cliente_id_seq', data.clients, 'idcliente']
    ]) await restartSequence(target, sequence, rows, key);

    for (const [table, count] of [
      ['categoria_menu', 11], ['unidad_menu', 25], ['grupo_menu', 2],
      ['producto_menu', 165], ['cliente', 28], ['zona_cliente', preserved.zona_cliente + 51]
    ]) {
      const actual = Number((await target.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
      assert(actual === count, `${table}: esperado ${count}, obtenido ${actual}`);
    }
    for (const [table, count] of Object.entries(preserved)) {
      const expected = table === 'zona_cliente' ? count + 51 : count;
      const actual = Number((await target.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
      assert(actual === expected, `Se alteró la configuración conservada: ${table}`);
    }
    const occupied = await target.query("SELECT count(*)::int AS n FROM mesa WHERE estado<>'libre'");
    assert(occupied.rows[0].n === 0, 'Quedaron mesas ocupadas');
    await target.query('COMMIT');
    committed = true;
    targetStarted = false;
    const report = { ...data.report, migratedAt: new Date().toISOString(), sourceDatabase: sourceName, targetDatabase: targetName, before, preserved, zoneIdMap: Object.fromEntries(zoneIdMap), backups: backupFolder };
    const reportName = targetName === productionTargetName ? 'migration-report.json' : 'migration-test-report.json';
    try { await writeFile(path.join(backupFolder, reportName), `${JSON.stringify(report, null, 2)}\n`, 'utf8'); }
    catch (error) { console.error(`Migración confirmada; no se pudo guardar el informe: ${error.message}`); }
    console.log('Migración confirmada:', JSON.stringify({ products: 165, clients: 28, zonesAdded: 51, clearedOrders: before.pedido, clearedAccounts: before.cuenta }));
  }
} catch (error) {
  if (targetStarted) await target.query('ROLLBACK').catch(() => {});
  console.error(committed ? 'La migración se confirmó, pero hubo un error posterior:' : 'Migración cancelada y revertida:', error.message);
  process.exitCode = 1;
} finally {
  if (sourceStarted) await source.query('ROLLBACK').catch(() => {});
  await source?.end().catch(() => {});
  await target?.end().catch(() => {});
}
