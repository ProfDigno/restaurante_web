import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';
const c=await pool.connect();
try {
 await c.query('BEGIN');
 await c.query('SELECT pg_advisory_xact_lock(7092026)');
 const applied=(await c.query("SELECT to_regclass('public.devolucion_pago') AS tabla")).rows[0].tabla;
 if (!applied) await c.query(await readFile(new URL('./migrations/20260907_pedidos_web.sql',import.meta.url),'utf8'));
 await c.query('COMMIT'); console.log(applied?'Migración ya aplicada':'Migración aplicada sin borrar datos');
} catch(e){await c.query('ROLLBACK');console.error(e.message);process.exitCode=1;} finally {c.release();await pool.end();}
