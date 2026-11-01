import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sourceName = 'bdsamu_8';
const targetName = process.env.DB_NAME || 'bdrestaurante_web';
if (sourceName === targetName) throw new Error('El origen y el destino no pueden ser la misma base');

const bin = path.join(process.env.PG95_BIN || 'C:\\Program Files\\PostgreSQL\\9.5\\bin');
const connection = ['-h', process.env.DB_HOST || '127.0.0.1', '-p', process.env.DB_PORT || '5432', '-U', process.env.DB_USER || 'postgres'];
const childEnv = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' };

function run(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(bin, exe), args, { env: childEnv, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`${exe} terminó con código ${code}: ${stderr.trim()}`)));
  });
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const parent = path.resolve(process.cwd(), '..', 'RESTAURANTE_BACKUPS');
await mkdir(parent, { recursive: true });
const folder = await mkdtemp(path.join(parent, `${new Date().toISOString().replace(/[:.]/g, '-')}-`));
const archives = {};

for (const database of [sourceName, targetName]) {
  const file = path.join(folder, `${database}.dump`);
  await run('pg_dump.exe', [...connection, '-Fc', '-f', file, database]);
  const contents = await run('pg_restore.exe', ['-l', file]);
  if (!contents.includes('TABLE public cliente')) throw new Error(`El respaldo de ${database} no contiene cliente`);
  const fileStat = await stat(file);
  archives[database] = { file, bytes: fileStat.size, sha256: await sha256(file) };
  console.log(`Respaldo verificado: ${database}, ${fileStat.size} bytes`);
}

const manifest = { createdAt: new Date().toISOString(), sourceName, targetName, archives };
await writeFile(path.join(folder, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`BACKUP_DIR=${folder}`);
