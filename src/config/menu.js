export const menuSections = [
  {
    id: 'operacion', label: 'Operación', icon: '▣', items: [
      { id: 'mesas', label: 'Mesas', path: '/mesas' },
      { id: 'historial-mesas', label: 'Historial de mesas', path: '/historial-mesas' },
      { id: 'pedidos', label: 'Pedidos', path: '/pedidos' },
      { id: 'solo-pedido', label: 'Solo pedido', path: '/pedido', permission: 'pedidos', external: true },
      { id: 'comanda', label: 'Comanda', path: '/comanda' },
      { id: 'kpi-pedidos', label: 'Análisis de pedidos', path: '/kpi-pedidos' },
      { id: 'buscar', label: 'Buscar pedidos', path: '/buscar' }
    ]
  },
  {
    id: 'usuarios', label: 'Usuarios', icon: '◎', items: [
      { id: 'usuarios', label: 'Usuarios', path: '/usuarios' },
      { id: 'roles', label: 'Roles', path: '/roles' },
      { id: 'permisos', label: 'Permisos', path: '/permisos' },
      { id: 'personal', label: 'Personal', path: '/personal' }
    ]
  },
  {
    id: 'cliente', label: 'Cliente', icon: '◇', items: [
      { id: 'clientes', label: 'Clientes', path: '/clientes' },
      { id: 'zonas', label: 'Zonas de clientes', path: '/zonas' },
      { id: 'delivery', label: 'Delivery', path: '/delivery' }
    ]
  },
  {
    id: 'productos', label: 'Productos', icon: '▤', items: [
      { id: 'categorias', label: 'Categorías', path: '/categorias' },
      { id: 'menu', label: 'Productos del menú', path: '/menu' },
      { id: 'grupos', label: 'Grupos de menú', path: '/grupos' },
      { id: 'unidades-menu', label: 'Unidades de menú', path: '/unidades-menu' },
      { id: 'ingredientes', label: 'Ingredientes', path: '/ingredientes' },
      { id: 'unidades-medida', label: 'Unidades de medida', path: '/unidades-medida' },
      { id: 'conversiones-unidad', label: 'Conversiones de unidades', path: '/conversiones-unidad' }
    ]
  },
  {
    id: 'mesas-configuracion', label: 'Mesas', icon: '▣', items: [
      { id: 'ubicaciones-mesa', label: 'Ubicaciones de mesas', path: '/ubicaciones-mesa' },
      { id: 'mesas-config', label: 'Configuración de mesas', path: '/mesas-config' }
    ]
  },
  {
    id: 'finanzas', label: 'Caja y finanzas', icon: '$', items: [
      { id: 'caja', label: 'Caja general', path: '/caja' },
      { id: 'arqueos', label: 'Arqueos', path: '/arqueos' },
      { id: 'pagos', label: 'Pagos', path: '/pagos' },
      { id: 'vales', label: 'Vales', path: '/vales' },
      { id: 'formas-pago', label: 'Formas de pago', path: '/formas-pago' }
    ]
  },
  {
    id: 'gasto', label: 'Gasto', icon: '↘', items: [
      { id: 'gastos', label: 'Gastos', path: '/gastos' },
      { id: 'kpi-gastos', label: 'Análisis de gastos', path: '/kpi-gastos' },
      { id: 'gasto-tipos', label: 'Tipos de gasto', path: '/gasto-tipos' }
    ]
  },
  {
    id: 'compra', label: 'Compra', icon: '▤', items: [
      { id: 'compras', label: 'Compra', path: '/compras' },
      { id: 'proveedores', label: 'Proveedor', path: '/proveedores' }
    ]
  },
  {
    id: 'inventario', label: 'Compras e inventario', icon: '▤', items: [
      { id: 'inventario-ingredientes', label: 'Inventario de ingredientes', path: '/inventario/ingredientes' },
      { id: 'inventario-productos', label: 'Inventario de productos', path: '/inventario/productos' },
      { id: 'movimientos', label: 'Movimientos de stock', path: '/movimientos-stock' }
    ]
  }
];

export const implementedForms = new Set([
  'mesas', 'historial-mesas', 'pedidos', 'comanda', 'kpi-pedidos', 'delivery', 'menu', 'categorias', 'grupos',
  'unidades-menu', 'ubicaciones-mesa', 'mesas-config', 'ingredientes',
  'unidades-medida', 'conversiones-unidad', 'caja', 'formas-pago', 'gastos', 'kpi-gastos', 'gasto-tipos',
  'clientes', 'zonas', 'usuarios', 'roles', 'permisos', 'compras', 'proveedores'
]);

export const permissionCode = (formId) => `FORM_${formId.toUpperCase().replaceAll('-', '_')}`;
export const formDefinitions = menuSections.flatMap(section => section.items
  .filter(item => implementedForms.has(item.id))
  .map(item => ({ id: item.id, label: item.label, section: section.label, code: permissionCode(item.id) })));

export function menuForPermissions(permissions = []) {
  const granted = new Set(permissions);
  return menuSections
    .map((section) => ({ ...section, items: section.items
      .filter(item => (implementedForms.has(item.id) || item.permission) && granted.has(permissionCode(item.permission || item.id)))
      .map(({ roles, ...item }) => item) }))
    .filter((section) => section.items.length > 0);
}
