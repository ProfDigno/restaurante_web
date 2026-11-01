import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const folder = process.env.SAMU_BACKUP_DIR;
assert.ok(folder, 'Definí SAMU_BACKUP_DIR');
const { source, target } = JSON.parse(await readFile(path.join(folder, 'sandbox.json'), 'utf8'));
assert.match(source, /^samu_stage_[0-9]{17}_[0-9]+$/);
assert.match(target, /^samu_test_[0-9]{17}_[0-9]+$/);
const client = new pg.Client({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '', database: 'postgres' });
await client.connect();
try {
  for (const database of [source, target]) {
    const sessions = await client.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [database]);
    assert.equal(sessions.rows[0].n, 0, `${database} todavía tiene conexiones`);
    await client.query(`DROP DATABASE "${database}"`);
    console.log(`Base temporal eliminada: ${database}`);
  }
} finally { await client.end(); }
