import 'dotenv/config';
import assert from 'node:assert/strict';
import { pool } from '../src/config/database.js';

const pattern = ' \\[SAMU [0-9]+\\]$';
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '10s'");
  const before = await client.query('SELECT idproducto_menu, nombre FROM producto_menu WHERE nombre ~ $1 ORDER BY idproducto_menu FOR UPDATE', [pattern]);
  assert.equal(before.rowCount, 104, `Se esperaban 104 productos para limpiar y se encontraron ${before.rowCount}`);
  await client.query('ALTER TABLE producto_menu DROP CONSTRAINT IF EXISTS producto_menu_categoria_nombre_unico');
  const updated = await client.query("UPDATE producto_menu SET nombre=regexp_replace(nombre,$1,'') WHERE nombre ~ $1 RETURNING idproducto_menu,nombre", [pattern]);
  assert.equal(updated.rowCount, before.rowCount);
  const remaining = await client.query('SELECT count(*)::int AS n FROM producto_menu WHERE nombre ~ $1', [pattern]);
  assert.equal(remaining.rows[0].n, 0, 'Quedaron sufijos SAMU sin limpiar');
  await client.query('COMMIT');
  console.log(`Productos actualizados: ${updated.rowCount}. Sufijos restantes: 0.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
