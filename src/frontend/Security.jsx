import { Fragment, useEffect, useState } from 'react';
import { formDefinitions } from '../config/menu.js';
import './security.css';

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación');
  return data;
}
const saveOptions = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const settings = {
  usuarios: { title: 'Usuarios', singular: 'usuario', description: 'Administrá las cuentas y sus roles.', id: 'idusuario', button: '+ Nuevo usuario' },
  roles: { title: 'Roles', singular: 'rol', description: 'Definí los roles y los formularios a los que pueden acceder.', id: 'idusuario_rol', button: '+ Nuevo rol' },
  permisos: { title: 'Permisos', singular: 'permiso', description: 'Configurá los permisos de los formularios existentes.', id: 'idusuario_rol_evento' }
};

const formByCode = new Map(formDefinitions.map(form => [form.code, form]));

function RolePermissionTable({ role, permissions, loading, loadError, saving, onSave }) {
  const [selected, setSelected] = useState(role.permisos || []);
  const [error, setError] = useState('');
  const changed = selected.length !== role.permisos.length || selected.some(code => !role.permisos.includes(code));
  const save = async () => {
    setError('');
    try { await onSave({ rol: role.rol, activo: role.activo, permisos: selected }, role); }
    catch (reason) { setError(reason.message); }
  };
  return <div className="role-permissions-panel">
    <div className="role-permissions-heading"><div><strong>Permisos de {role.rol}</strong><span>Marcá los formularios a los que puede acceder este rol.</span></div><span>{selected.length} asignados</span></div>
    {loadError && <div className="alert error">{loadError}</div>}
    {loading ? <p className="muted">Cargando permisos…</p> : <div className="role-permissions-scroll"><table className="role-permissions-table"><thead><tr><th>Formulario</th><th>Sección</th><th>Acceso</th></tr></thead><tbody>{permissions.map(permission => <tr key={permission.codigo_evento}>
      <td><strong>{permission.nombre}</strong>{!permission.activo && <small>Permiso inactivo</small>}</td>
      <td>{formByCode.get(permission.codigo_evento)?.section || '—'}</td>
      <td><label className="role-permission-choice check-label"><input type="checkbox" disabled={!permission.activo || saving} checked={selected.includes(permission.codigo_evento)} onChange={event => setSelected(current => event.target.checked ? [...current, permission.codigo_evento] : current.filter(code => code !== permission.codigo_evento))} /><span>{selected.includes(permission.codigo_evento) ? 'Permitido' : 'Sin acceso'}</span></label></td>
    </tr>)}</tbody></table></div>}
    {error && <div className="alert error">{error}</div>}
    <div className="role-permissions-actions"><button type="button" className="secondary" disabled={!changed || saving} onClick={() => { setSelected(role.permisos || []); setError(''); }}>Descartar</button><button type="button" className="primary" disabled={!changed || loading || !!loadError || saving} onClick={save}>{saving ? 'Guardando…' : 'Guardar permisos'}</button></div>
  </div>;
}

function Editor({ kind, item, roles, permissions, permissionsLoading, permissionsError, saving, onSave, onClose }) {
  const [form, setForm] = useState(() => kind === 'usuarios'
    ? { login: item?.login || '', nombre: item?.nombre || '', password: '', fk_idusuario_rol: item?.fk_idusuario_rol || '', activo: item?.activo ?? true }
    : kind === 'roles'
      ? { rol: item?.rol || '', permisos: item?.permisos || [], activo: item?.activo ?? true }
      : { nombre: item?.nombre || '', descripcion: item?.descripcion || '', activo: item?.activo ?? true });
  const [error, setError] = useState('');
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const submit = async event => { event.preventDefault(); setError(''); try { await onSave(form); } catch (reason) { setError(reason.message); } };
  const title = item ? `Editar ${settings[kind].singular}` : `Crear ${settings[kind].singular}`;
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="modal product-modal security-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><div><p className="eyebrow">{item ? 'EDITAR' : 'NUEVO'}</p><h2>{title}</h2></div><button type="button" className="modal-close" aria-label="Cerrar" onClick={onClose}>×</button></div>
      <form className="modal-form" onSubmit={submit}>
        {kind === 'usuarios' && <>
          <label>Usuario<input autoFocus required maxLength="50" autoComplete="off" value={form.login} onChange={event => change('login', event.target.value)} /></label>
          <label>Nombre<input required maxLength="120" value={form.nombre} onChange={event => change('nombre', event.target.value)} /></label>
          <label>Rol<select required value={form.fk_idusuario_rol} onChange={event => change('fk_idusuario_rol', event.target.value)}><option value="">Seleccioná un rol</option>{roles.map(role => <option key={role.idusuario_rol} value={role.idusuario_rol}>{role.rol}</option>)}</select></label>
          <label>{item ? 'Nueva contraseña (opcional)' : 'Contraseña'}<input type="password" autoComplete="new-password" required={!item} minLength="8" maxLength="100" value={form.password} onChange={event => change('password', event.target.value)} /></label>
        </>}
        {kind === 'roles' && <>
          <label>Nombre del rol<input autoFocus required maxLength="80" value={form.rol} onChange={event => change('rol', event.target.value)} /></label>
          <fieldset className="security-permissions"><legend>Permisos del rol</legend>
            {permissionsLoading ? <p className="muted">Cargando permisos…</p> : permissionsError ? <div className="alert error">{permissionsError}</div> :
              <div className="role-permissions-scroll"><table className="role-permissions-table"><thead><tr><th>Formulario</th><th>Sección</th><th>Acceso</th></tr></thead><tbody>{permissions.map(permission => <tr key={permission.codigo_evento}>
                <td><strong>{permission.nombre}</strong>{!permission.activo && <small>Permiso inactivo</small>}</td>
                <td>{formByCode.get(permission.codigo_evento)?.section || '—'}</td>
                <td><label className="role-permission-choice check-label"><input type="checkbox" disabled={!permission.activo || saving} checked={form.permisos.includes(permission.codigo_evento)} onChange={event => change('permisos', event.target.checked ? [...form.permisos, permission.codigo_evento] : form.permisos.filter(code => code !== permission.codigo_evento))} /><span>{form.permisos.includes(permission.codigo_evento) ? 'Permitido' : 'Sin acceso'}</span></label></td>
              </tr>)}</tbody></table></div>}
          </fieldset>
        </>}
        {kind === 'permisos' && <>
          <label>Formulario<input value={item.codigo_evento} disabled /></label>
          <label>Nombre del permiso<input autoFocus required maxLength="150" value={form.nombre} onChange={event => change('nombre', event.target.value)} /></label>
          <label>Descripción<textarea rows="3" maxLength="500" value={form.descripcion} onChange={event => change('descripcion', event.target.value)} /></label>
        </>}
        <label className="check-label"><input type="checkbox" checked={form.activo} onChange={event => change('activo', event.target.checked)} /> Activo</label>
        {error && <div className="alert error">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving || (kind === 'roles' && (permissionsLoading || !!permissionsError))}>{saving ? 'Guardando…' : `Guardar ${settings[kind].singular}`}</button></div>
      </form>
    </div>
  </div>;
}

export default function Security({ kind, onAccessChange }) {
  const config = settings[kind];
  const [items, setItems] = useState([]); const [search, setSearch] = useState('');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0); const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [modal, setModal] = useState(undefined); const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(null); const [roles, setRoles] = useState([]); const [permissions, setPermissions] = useState([]);
  const [expandedRoleId, setExpandedRoleId] = useState(null);
  const [permissionsLoading, setPermissionsLoading] = useState(false); const [permissionsError, setPermissionsError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try {
      const data = await request(`/api/${kind}?${new URLSearchParams({ search, page, pageSize })}`);
      setItems(data.items); setTotal(data.total); setTotalPages(data.totalPages);
    } catch (reason) { setError(reason.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [kind, search, page, pageSize]);
  useEffect(() => {
    if (kind === 'usuarios') request('/api/roles/opciones').then(data => setRoles(data.items)).catch(reason => setError(reason.message));
    if (kind === 'roles') {
      setPermissionsLoading(true); setPermissionsError('');
      request('/api/permisos?pageSize=100').then(data => setPermissions(data.items)).catch(reason => setPermissionsError(reason.message)).finally(() => setPermissionsLoading(false));
    }
  }, [kind]);
  const save = async (form, item = modal) => {
    setSaving(true);
    try {
      const editing = item?.[config.id];
      await request(editing ? `/api/${kind}/${editing}` : `/api/${kind}`, saveOptions(editing ? 'PUT' : 'POST', form));
      setModal(undefined); await load(); await onAccessChange?.();
    } finally { setSaving(false); }
  };
  const toggle = async item => { try { await save({ ...item, activo: !item.activo, password: '' }, item); } catch (reason) { setError(reason.message); } };
  const selected = items.find(item => item[config.id] === selectedId);
  const columns = kind === 'usuarios' ? ['Usuario', 'Nombre', 'Rol', 'Estado'] : kind === 'roles' ? ['Rol', 'Usuarios', 'Permisos', 'Estado'] : ['Permiso', 'Formulario', 'Roles', 'Estado'];
  return <div className={`catalog-page security-page security-${kind}-page`}>
    <div className="page-intro"><div><p className="eyebrow">PERSONAS Y SEGURIDAD</p><h2>{config.title}</h2><p className="muted">{config.description}</p></div>{config.button && <button className="primary" onClick={() => setModal(null)}>{config.button}</button>}</div>
    <div className="catalog-toolbar"><div className="search-box"><span>⌕</span><input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder={`Buscar ${config.title.toLowerCase()}…`} /></div><div className="toolbar-audit">{selected ? <><strong>{selected.nombre || selected.rol}</strong><span>{selected.fecha_creado ? new Intl.DateTimeFormat('es-PY', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(selected.fecha_creado)) : '—'} · {selected.creado_por}</span></> : <span>Seleccioná un registro para ver fecha y creador</span>}</div><div className="result-count">{total} {config.title.toLowerCase()}</div></div>
    {error && <div className="alert error catalog-error">{error}</div>}
    <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}<th className="actions-col">Acciones</th></tr></thead><tbody>{loading ? <tr><td colSpan="5" className="table-loading">Cargando {config.title.toLowerCase()}…</td></tr> : !items.length ? <tr><td colSpan="5" className="table-empty">No hay registros.</td></tr> : items.map(item => <Fragment key={item[config.id]}><tr onClick={() => setSelectedId(item[config.id])} className={`${!item.activo ? 'inactive-row ' : ''}${selectedId === item[config.id] ? 'selected-row' : ''}`}>
      {kind === 'usuarios' ? <><td><strong>{item.login}</strong><small>ID {item.idusuario}</small></td><td>{item.nombre}</td><td>{item.rol || 'Sin rol'}</td></> : kind === 'roles' ? <><td><strong>{item.rol}</strong><small>ID {item.idusuario_rol}</small></td><td>{item.usuarios}</td><td>{item.permisos.length}</td></> : <><td><strong>{item.nombre}</strong><small>{item.descripcion || 'Sin descripción'}</small></td><td>{item.codigo_evento.replace('FORM_', '').replaceAll('_', ' ')}</td><td>{item.roles}</td></>}
      <td><label className="switch"><input type="checkbox" checked={item.activo} onChange={() => toggle(item)} /><span className="slider" /></label><span className={`state-label ${item.activo ? 'on' : 'off'}`}>{item.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td className="actions-col"><div className="security-row-actions">{kind === 'roles' && <button className="edit-button" aria-expanded={expandedRoleId === item.idusuario_rol} onClick={event => { event.stopPropagation(); setExpandedRoleId(current => current === item.idusuario_rol ? null : item.idusuario_rol); }}>{expandedRoleId === item.idusuario_rol ? 'Cerrar permisos' : 'Permisos'}</button>}<button className="edit-button" onClick={event => { event.stopPropagation(); setModal(item); }}>Editar</button></div></td>
    </tr>{kind === 'roles' && expandedRoleId === item.idusuario_rol && <tr className="role-permissions-row"><td colSpan="5"><RolePermissionTable key={item.idusuario_rol} role={item} permissions={permissions} loading={permissionsLoading} loadError={permissionsError} saving={saving} onSave={save} /></td></tr>}</Fragment>)}</tbody></table></div>
    <div className="catalog-footer"><label>Mostrar <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}><option>25</option><option>50</option><option>100</option></select></label><span>Página {page} de {totalPages}</span><div className="pagination"><button className="page-button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>Siguiente</button></div></div>
    {modal !== undefined && <Editor key={`${kind}-${modal?.[config.id] || 'new'}`} kind={kind} item={modal} roles={roles} permissions={permissions} permissionsLoading={permissionsLoading} permissionsError={permissionsError} saving={saving} onSave={save} onClose={() => setModal(undefined)} />}
  </div>;
}
