import type { Role, UserProfile } from '../types/pos';

export interface PermissionCatalogItem {
  id: string;
  module: string;
  action: string;
  label: string;
  description: string;
}

export const PERMISSION_CATALOG: PermissionCatalogItem[] = [
  { id: 'dashboard.view', module: 'Dashboard', action: 'View', label: 'View Dashboard', description: 'Access role-specific KPI dashboard' },

  { id: 'sales.view', module: 'POS & Sales', action: 'View', label: 'View Sales', description: 'Inspect sales history and receipts' },
  { id: 'sales.create', module: 'POS & Sales', action: 'Create', label: 'Create POS Sales', description: 'Process checkout transactions at POS' },
  { id: 'sales.edit', module: 'POS & Sales', action: 'Edit', label: 'Apply Discounts', description: 'Apply authorized line or cart discounts' },
  { id: 'sales.cancel', module: 'POS & Sales', action: 'Delete', label: 'Cancel Sales', description: 'Void unposted or pending sales' },
  { id: 'sales.refund', module: 'POS & Sales', action: 'Create', label: 'Request Refunds', description: 'Submit customer return and refund requests' },
  { id: 'sales.approve', module: 'POS & Sales', action: 'Approve', label: 'Approve Refunds', description: 'Approve and process refund requests' },
  { id: 'sales.export', module: 'POS & Sales', action: 'Export', label: 'Export Sales', description: 'Export sales records to CSV/PDF' },

  { id: 'products.view', module: 'Products', action: 'View', label: 'View Products', description: 'View central product catalog' },
  { id: 'products.create', module: 'Products', action: 'Create', label: 'Create Products', description: 'Add new products and categories' },
  { id: 'products.edit', module: 'Products', action: 'Edit', label: 'Edit Products', description: 'Modify product pricing and details' },
  { id: 'products.delete', module: 'Products', action: 'Delete', label: 'Archive Products', description: 'Archive inactive products' },

  { id: 'inventory.view', module: 'Inventory', action: 'View', label: 'View Inventory', description: 'View branch stock levels and movements' },
  { id: 'inventory.adjust', module: 'Inventory', action: 'Edit', label: 'Adjust Stock', description: 'Perform stock additions, reductions, counts, and write-offs' },
  { id: 'inventory.transfer', module: 'Inventory', action: 'Create', label: 'Stock Transfers', description: 'Create, dispatch, and receive inter-branch stock transfers' },
  { id: 'inventory.approve', module: 'Inventory', action: 'Approve', label: 'Approve Transfers', description: 'Approve or reject stock transfer requests' },
  { id: 'inventory.export', module: 'Inventory', action: 'Export', label: 'Export Inventory', description: 'Export inventory valuation and movement reports' },

  { id: 'purchases.view', module: 'Purchases', action: 'View', label: 'View Purchases', description: 'View branch purchase orders and invoices' },
  { id: 'purchases.create', module: 'Purchases', action: 'Create', label: 'Create Purchases', description: 'Create and submit purchase orders' },
  { id: 'purchases.approve', module: 'Purchases', action: 'Approve', label: 'Approve & Receive POs', description: 'Approve purchase orders and receive goods into stock' },

  { id: 'suppliers.view', module: 'Suppliers', action: 'View', label: 'View Suppliers', description: 'View supplier directory' },
  { id: 'suppliers.manage', module: 'Suppliers', action: 'Manage', label: 'Manage Suppliers', description: 'Create and update supplier profiles' },

  { id: 'customers.view', module: 'Customers', action: 'View', label: 'View Customers', description: 'View customer profiles and purchase history' },
  { id: 'customers.create', module: 'Customers', action: 'Create', label: 'Create Customers', description: 'Register new retail customers' },
  { id: 'customers.edit', module: 'Customers', action: 'Edit', label: 'Edit Customers', description: 'Edit customer contact details' },
  { id: 'customers.delete', module: 'Customers', action: 'Delete', label: 'Delete Customers', description: 'Remove inactive customer records' },

  { id: 'expenses.view', module: 'Expenses', action: 'View', label: 'View Expenses', description: 'View branch expense records' },
  { id: 'expenses.create', module: 'Expenses', action: 'Create', label: 'Submit Expenses', description: 'Record branch operating expenses' },
  { id: 'expenses.approve', module: 'Expenses', action: 'Approve', label: 'Approve Expenses', description: 'Approve or reject expense submissions' },

  { id: 'cashSessions.view', module: 'Cash Register', action: 'View', label: 'View Cash Sessions', description: 'View cash register shift logs' },
  { id: 'cashSessions.open', module: 'Cash Register', action: 'Create', label: 'Open Cash Session', description: 'Open a new cashier shift with opening float' },
  { id: 'cashSessions.close', module: 'Cash Register', action: 'Edit', label: 'Close Cash Session', description: 'Count drawer and close an open shift' },
  { id: 'cashSessions.approve', module: 'Cash Register', action: 'Approve', label: 'Approve Cash Sessions', description: 'Sign off closed shifts and discrepancies' },

  { id: 'reports.view', module: 'Reports', action: 'View', label: 'View Reports', description: 'Access sales, inventory, and financial reports' },
  { id: 'reports.export', module: 'Reports', action: 'Export', label: 'Export Reports', description: 'Download CSV/PDF and print reports' },

  { id: 'users.view', module: 'User Management', action: 'View', label: 'View Users', description: 'View staff accounts and login history' },
  { id: 'users.create', module: 'User Management', action: 'Create', label: 'Invite Users', description: 'Send staff invitations with role/branch assignments' },
  { id: 'users.edit', module: 'User Management', action: 'Edit', label: 'Edit Users', description: 'Edit user branch assignments and roles' },
  { id: 'users.suspend', module: 'User Management', action: 'Manage', label: 'Suspend/Activate Users', description: 'Suspend or reactivate user accounts' },
  { id: 'users.manage', module: 'User Management', action: 'Manage', label: 'Manage Permission Overrides', description: 'Apply individual user permission overrides' },

  { id: 'branches.view', module: 'Branches', action: 'View', label: 'View Branches', description: 'View branch details and comparison metrics' },
  { id: 'branches.create', module: 'Branches', action: 'Create', label: 'Create Branches', description: 'Register new retail branches' },
  { id: 'branches.edit', module: 'Branches', action: 'Edit', label: 'Edit Branches', description: 'Update branch profile and hours' },
  { id: 'branches.manage', module: 'Branches', action: 'Manage', label: 'Activate/Suspend Branches', description: 'Suspend or reactivate branch operations' },

  { id: 'roles.view', module: 'Access Policies', action: 'View', label: 'View Roles & Matrix', description: 'View RBAC roles and permission assignments' },
  { id: 'roles.create', module: 'Access Policies', action: 'Create', label: 'Create Roles', description: 'Create custom administrator-defined roles' },
  { id: 'roles.edit', module: 'Access Policies', action: 'Edit', label: 'Edit Role Permissions', description: 'Modify permissions assigned to roles' },
  { id: 'roles.delete', module: 'Access Policies', action: 'Delete', label: 'Delete Roles', description: 'Delete unused custom roles' },
  { id: 'roles.manage', module: 'Access Policies', action: 'Manage', label: 'Toggle Role Status', description: 'Activate or deactivate roles' },

  { id: 'settings.view', module: 'Settings', action: 'View', label: 'View Settings', description: 'View organization and receipt policies' },
  { id: 'settings.manage', module: 'Settings', action: 'Manage', label: 'Manage Settings', description: 'Update tax, currency, receipt, and approval settings' },

  { id: 'auditLogs.view', module: 'Audit & Security', action: 'View', label: 'View Audit Logs', description: 'Inspect security and operational audit trail' },
];

export const ALL_PERMISSION_IDS = PERMISSION_CATALOG.map((p) => p.id);

export const DEFAULT_ROLE_PRESETS: Array<{
  roleId: string;
  name: string;
  description: string;
  scope: 'organization' | 'branch';
  permissions: string[];
}> = [
  {
    roleId: 'role_super_admin',
    name: 'Super Admin',
    description: 'Head Office administrator with unrestricted organization-wide control across all branches and policies.',
    scope: 'organization',
    permissions: ALL_PERMISSION_IDS,
  },
  {
    roleId: 'role_branch_admin',
    name: 'Branch Administrator',
    description: 'Manages assigned branch operations, staff, inventory, purchasing, and branch reporting.',
    scope: 'branch',
    permissions: [
      'dashboard.view',
      'sales.view', 'sales.create', 'sales.edit', 'sales.cancel', 'sales.refund', 'sales.approve', 'sales.export',
      'products.view', 'products.create', 'products.edit',
      'inventory.view', 'inventory.adjust', 'inventory.transfer', 'inventory.approve', 'inventory.export',
      'purchases.view', 'purchases.create', 'purchases.approve',
      'suppliers.view', 'suppliers.manage',
      'customers.view', 'customers.create', 'customers.edit',
      'expenses.view', 'expenses.create', 'expenses.approve',
      'cashSessions.view', 'cashSessions.open', 'cashSessions.close', 'cashSessions.approve',
      'reports.view', 'reports.export',
      'users.view', 'users.create', 'users.edit', 'users.suspend',
      'branches.view',
      'settings.view',
    ],
  },
  {
    roleId: 'role_supervisor',
    name: 'Supervisor',
    description: 'Oversees daily floor operations, cashier shifts, refund approvals, stock adjustments, and branch expenses.',
    scope: 'branch',
    permissions: [
      'dashboard.view',
      'sales.view', 'sales.create', 'sales.edit', 'sales.refund', 'sales.approve', 'sales.export',
      'products.view',
      'inventory.view', 'inventory.adjust', 'inventory.transfer', 'inventory.approve',
      'purchases.view', 'purchases.create',
      'suppliers.view',
      'customers.view', 'customers.create', 'customers.edit',
      'expenses.view', 'expenses.create', 'expenses.approve',
      'cashSessions.view', 'cashSessions.open', 'cashSessions.close', 'cashSessions.approve',
      'reports.view',
      'branches.view',
    ],
  },
  {
    roleId: 'role_cashier',
    name: 'Cashier',
    description: 'Processes retail POS sales, opens/closes personal cash register shifts, and looks up customers.',
    scope: 'branch',
    permissions: [
      'dashboard.view',
      'sales.view', 'sales.create', 'sales.refund',
      'products.view',
      'inventory.view',
      'customers.view', 'customers.create',
      'cashSessions.view', 'cashSessions.open', 'cashSessions.close',
    ],
  },
];

export function resolveEffectivePermissions(
  user: UserProfile | null,
  role: Role | null
): Set<string> {
  if (!user || user.accountStatus !== 'active') {
    return new Set();
  }
  const base = role && role.isActive ? role.permissions : [];
  const effective = new Set<string>(base);
  for (const granted of user.grantedPermissions || []) {
    effective.add(granted);
  }
  for (const denied of user.deniedPermissions || []) {
    effective.delete(denied);
  }
  return effective;
}

export function hasUserPermission(
  user: UserProfile | null,
  role: Role | null,
  permissionId: string
): boolean {
  if (!user || user.accountStatus !== 'active') return false;
  if (role?.scope === 'organization' && role.isActive) return true;
  const effective = resolveEffectivePermissions(user, role);
  return effective.has(permissionId);
}

export function canAccessBranch(
  user: UserProfile | null,
  role: Role | null,
  branchId: string
): boolean {
  if (!user || user.accountStatus !== 'active') return false;
  if (role?.scope === 'organization' && role.isActive) return true;
  return user.branchIds.includes(branchId);
}
