import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const folder = process.env.SAMU_BACKUP_DIR;
if (!folder) throw new Error('Definí SAMU_BACKUP_DIR');
const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
if (manifest.sourceName !== 'bdsamu_8' || manifest.targetName !== (process.env.DB_NAME || 'bdrestaurante_web')) throw new Error('Manifiesto inesperado');
const bin = process.env.PG95_BIN || 'C:\\Program Files\\PostgreSQL\\9.5\\bin';
const connection = ['-h', process.env.DB_HOST || '127.0.0.1', '-p', process.env.DB_PORT || '5432', '-U', process.env.DB_USER || 'postgres'];
const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' };

function run(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(bin, exe), args, { env, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${exe} (${code}): ${stderr.trim()}`)));
  });
}

const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '') + '_' + process.pid;
const stages = { source: `samu_stage_${suffix}`, target: `samu_test_${suffix}` };
for (const [role, database] of Object.entries(stages)) {
  const original = role === 'source' ? manifest.sourceName : manifest.targetName;
  await run('createdb.exe', [...connection, database]);
  console.log(`Base temporal creada: ${database}`);
  await run('pg_restore.exe', [...connection, '--no-owner', '--no-acl', '-d', database, manifest.archives[original].file]);
  console.log(`Archivo restaurado: ${original} → ${database}`);
}
await writeFile(path.join(folder, 'sandbox.json'), `${JSON.stringify(stages, null, 2)}\n`, 'utf8');
console.log(`SAMU_SOURCE_DB=${stages.source}`);
console.log(`SAMU_TARGET_DB=${stages.target}`);
