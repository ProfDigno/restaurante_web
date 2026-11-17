// Importa los ingredientes de cada producto del sistema anterior (bdgorila_12) a una base ya importada
// (bdrestaurante_gorila) SIN recrearla: no toca pedidos, cajas ni nada cargado después.
//   npm run db:migrate-gorila-ingredientes              → simulación (hace todo en una transacción y la deshace)
//   npm run db:migrate-gorila-ingredientes -- --apply   → confirma
// Opciones: --target=<base destino>. Origen: GORILA_SOURCE_DB (por defecto bdgorila_12).
import 'dotenv/config';
import pg from 'pg';
import { importIngredientes, prepareIngredientes, readIngredientes } from './gorila-ingredientes.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const targetArg = args.find(a => a.startsWith('--target='));
const SOURCE_DB = process.env.GORILA_SOURCE_DB || 'bdgorila_12';
const TARGET_DB = targetArg ? targetArg.split('=')[1] : (process.env.GORILA_TARGET_DB || 'bdrestaurante_gorila');
const base = { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '' };

async function readSource() {
  const c = new pg.Client({ ...base, database: SOURCE_DB, application_name: 'gorila_ingredientes_source' });
  await c.connect();
  await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try { return await readIngredientes(c); } finally { await c.query('ROLLBACK'); await c.end(); }
}

try {
  console.log(`Origen: ${SOURCE_DB} (solo lectura) · Destino: ${TARGET_DB} · ${apply ? 'APLICAR' : 'simulación'}`);
  const src = await readSource();
  const prep = prepareIngredientes(src);
  console.log(`Origen: ${src.ingredientes.length} ingredientes, ${src.vinculos.length} vínculos → ${prep.ingredientes.length} ingredientes y ${prep.vinculos.length} vínculos útiles`);
  console.log('Avisos:', JSON.stringify(prep.avisos));
  const c = new pg.Client({ ...base, database: TARGET_DB, application_name: 'gorila_ingredientes_target' });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('gorila_ingredientes'))");
    const res = await importIngredientes(c, prep, 'MIGRACION_GORILA');
    console.log('Resultado:', JSON.stringify(res));
    if (apply) { await c.query('COMMIT'); console.log('Confirmado.'); }
    else { await c.query('ROLLBACK'); console.log('Simulación: no se modificó la base. Repetí con --apply para confirmar.'); }
  } catch (error) { await c.query('ROLLBACK').catch(() => {}); throw error; } finally { await c.end(); }
} catch (error) {
  console.error('Importación de ingredientes cancelada:', error.message);
  process.exitCode = 1;
}
