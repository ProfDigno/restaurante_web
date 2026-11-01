import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(20261012)');
  const before = (await client.query("SELECT count(*)::int AS total FROM pedido p JOIN cuenta c ON c.idcuenta=p.fk_idcuenta WHERE c.estado='cerrada' AND p.estado IN ('listo','entregado') AND cobrado_neto_cuenta(c.idcuenta)=c.total")).rows[0].total;
  await client.query(await readFile(new URL('./migrations/20261012_pedidos_pagados.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log(`Migración de pedidos pagados aplicada; ${before} pedido(s) histórico(s) actualizado(s)`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
