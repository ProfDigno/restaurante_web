import { Router } from 'express';
import ExcelJS from 'exceljs';
import { pool } from '../config/database.js';
import { ACCIONES } from '../services/auditoria.js';
import { styleHeaderRow } from '../services/report-xlsx.js';

// Auditoría: solo lectura. Filtros por fecha, usuario, acción y registro (entidad + id).
const router = Router();
const MAX_EXPORT = 10000;
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const bad = message => { const error = new Error(message); error.status = 400; throw error; };

function filters(query) {
  const where = [], values = [];
  const add = (sql, value) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
  const desde = String(query.desde || ''), hasta = String(query.hasta || '');
  if (desde) { if (!validDate(desde)) bad('Fecha "desde" inválida'); add('a.fecha >= ?::date', desde); }
  if (hasta) { if (!validDate(hasta)) bad('Fecha "hasta" inválida'); add("a.fecha < ?::date + INTERVAL '1 day'", hasta); }
  if (desde && hasta && desde > hasta) bad('La fecha "desde" no puede ser posterior a "hasta"');
  const usuario = String(query.usuario || '').trim();
  if (usuario) add('a.usuario_login = ?', usuario.slice(0, 50));
  const accion = String(query.accion || '');
  if (accion) { if (!ACCIONES[accion]) bad('Acción inválida'); add('a.accion = ?', accion); }
  const entidad = String(query.entidad || '');
  if (entidad) { if (!/^[a-z_]{1,40}$/.test(entidad)) bad('Registro inválido'); add('a.entidad = ?', entidad); }
  const idEntidad = String(query.id || '');
  if (idEntidad) { if (!/^[1-9][0-9]{0,8}$/.test(idEntidad)) bad('Número de registro inválido'); add('a.id_entidad = ?', Number(idEntidad)); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', values };
}

const columns = `a.idauditoria, a.fecha, a.usuario_login, a.ip, a.accion, a.entidad, a.id_entidad, a.antes, a.despues, a.motivo`;

router.get('/', async (req, res, next) => {
  try {
    const f = filters(req.query);
    const pageSize = [25, 50, 100].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 25;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const [items, count, usuarios] = await Promise.all([
      pool.query(`SELECT ${columns} FROM auditoria a ${f.sql} ORDER BY a.fecha DESC, a.idauditoria DESC LIMIT $${f.values.length + 1} OFFSET $${f.values.length + 2}`, [...f.values, pageSize, (page - 1) * pageSize]),
      pool.query(`SELECT count(*)::int AS total FROM auditoria a ${f.sql}`, f.values),
      pool.query('SELECT DISTINCT usuario_login FROM auditoria ORDER BY usuario_login')
    ]);
    const total = count.rows[0].total;
    res.json({ items: items.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      acciones: ACCIONES, usuarios: usuarios.rows.map(row => row.usuario_login) });
  } catch (error) { next(error); }
});

// Texto legible de un cambio: "precio_venta: 15000 → 18000; stock_actual: 10 → 4".
export function describirCambio(antes, despues) {
  const keys = [...new Set([...Object.keys(antes || {}), ...Object.keys(despues || {})])];
  const show = value => value === undefined ? '—' : Array.isArray(value) ? value.join(', ') : value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—');
  return keys.map(key => antes && despues && key in antes && key in despues ? `${key}: ${show(antes[key])} → ${show(despues[key])}`
    : `${key}: ${show(key in (despues || {}) ? despues[key] : antes[key])}`).join('; ');
}

router.get('/reporte.xlsx', async (req, res, next) => {
  try {
    const f = filters(req.query);
    const { rows } = await pool.query(`SELECT ${columns} FROM auditoria a ${f.sql} ORDER BY a.fecha DESC, a.idauditoria DESC LIMIT ${MAX_EXPORT + 1}`, f.values);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Restaurante Web';
    const ws = wb.addWorksheet('Auditoría', { views: [{ state: 'frozen', ySplit: 3 }] });
    ws.columns = [{ width: 8 }, { width: 19 }, { width: 14 }, { width: 16 }, { width: 30 }, { width: 18 }, { width: 70 }, { width: 40 }];
    ws.getCell('A1').value = 'Auditoría de acciones sensibles';
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A2').value = `Generado: ${new Date().toLocaleString('es-PY')}${rows.length > MAX_EXPORT ? ` · Se muestran los ${MAX_EXPORT} más recientes; acotá los filtros para ver el resto` : ''}`;
    const head = ws.getRow(3);
    head.values = ['#', 'Fecha', 'Usuario', 'IP', 'Acción', 'Registro', 'Cambio', 'Motivo'];
    styleHeaderRow(head);
    rows.slice(0, MAX_EXPORT).forEach((row, index) => {
      const line = ws.getRow(4 + index);
      // Excel no maneja zonas horarias: se escribe la hora local del servidor como si fuera UTC para que se vea igual que en pantalla.
      const localTime = new Date(row.fecha.getTime() - row.fecha.getTimezoneOffset() * 60000);
      line.values = [Number(row.idauditoria), localTime, row.usuario_login, row.ip || '', ACCIONES[row.accion] || row.accion,
        `${row.entidad}${row.id_entidad ? ` #${row.id_entidad}` : ''}`, describirCambio(row.antes, row.despues), row.motivo || ''];
      line.getCell(2).numFmt = 'dd/mm/yyyy hh:mm:ss';
      line.getCell(7).alignment = { wrapText: true, vertical: 'top' };
    });
    const file = await wb.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      'Cache-Control': 'no-store',
      'Content-Length': String(file.length)
    });
    res.send(Buffer.from(file));
  } catch (error) { next(error); }
});

export default router;
