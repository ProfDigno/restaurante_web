import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

const client=await pool.connect();
try{
  const exists=await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='compra_pago'");
  if(exists.rowCount){console.log('Pagos parciales de compra ya instalados');}
  else{
    await client.query('BEGIN');
    await client.query(await readFile(new URL('./migrations/20261017_compra_pagos_parciales.sql',import.meta.url),'utf8'));
    await client.query('COMMIT');
    console.log('Pagos parciales de compra instalados');
  }
}catch(error){await client.query('ROLLBACK');console.error(error.message);process.exitCode=1;}
finally{client.release();await pool.end();}
