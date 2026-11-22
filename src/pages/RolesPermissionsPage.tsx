import React, { useMemo, useState } from 'react';
import { Plus, Save, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { PERMISSION_CATALOG } from '../lib/permissions';
import {
  createRole,
  deleteUnusedRole,
  updateRole,
  updateUserAccess,
} from '../services/rbacService';
import type { Role } from '../types/pos';

export default function RolesPermissionsPage() {
  const { organization, hasPermission } = useAuth();
  const { roles, users } = useData();
  const { notify } = useToast();

  const canCreateRole = hasPermission('roles.create');
  const canEditRole = hasPermission('roles.edit');
  const canDeleteRole = hasPermission('roles.delete');
  const canManageRole = hasPermission('roles.manage');
  const canManageUserOverrides = hasPermission('users.manage');

  const [tab, setTab] = useState<'matrix' | 'overrides'>('matrix');

  // Pending matrix edits: map roleId -> Set<permissionId>
  const [draftRolePerms, setDraftRolePerms] = useState<Record<string, string[]>>({});
  const [confirmMatrixOpen, setConfirmMatrixOpen] = useState(false);
  const [savingMatrix, setSavingMatrix] = useState(false);

  // Create custom role modal
  const [createOpen, setCreateOpen] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [roleDesc, setRoleDesc] = useState('');
  const [roleScope, setRoleScope] = useState<'branch' | 'organization'>('branch');
  const [deleteConfirmRole, setDeleteConfirmRole] = useState<Role | null>(null);

  // Per-user override state
  const [selectedUid, setSelectedUid] = useState('');
  const [grantedDraft, setGrantedDraft] = useState<string[] | null>(null);
  const [deniedDraft, setDeniedDraft] = useState<string[] | null>(null);

  const groupedPermissions = useMemo(() => {
    const map = new Map<string, typeof PERMISSION_CATALOG>();
    for (const p of PERMISSION_CATALOG) {
      const list = map.get(p.module) || [];
      list.push(p);
      map.set(p.module, list);
    }
    return Array.from(map.entries());
  }, []);

  const roleUsageCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of users) {
      map.set(u.roleId, (map.get(u.roleId) || 0) + 1);
    }
    return map;
  }, [users]);

  const getEffectiveRolePerms = (role: Role): Set<string> => {
    const arr = draftRolePerms[role.roleId] ?? role.permissions;
    return new Set(arr);
  };

  const toggleRolePermission = (role: Role, permId: string) => {
    if (!canEditRole) return;
    if (role.roleId === 'role_super_admin') {
      notify('info', 'System Protected', 'Super Admin retains unrestricted organization permissions.');
      return;
    }
    const current = new Set(draftRolePerms[role.roleId] ?? role.permissions);
    if (current.has(permId)) {
      current.delete(permId);
    } else {
      current.add(permId);
    }
    setDraftRolePerms((prev) => ({
      ...prev,
      [role.roleId]: Array.from(current),
    }));
  };

  const dirtyRoleIds = Object.keys(draftRolePerms);

  const handleSaveMatrix = async () => {
    if (!organization || dirtyRoleIds.length === 0) return;
    setSavingMatrix(true);
    try {
      for (const roleId of dirtyRoleIds) {
        await updateRole(roleId, organization.organizationId, {
          permissions: draftRolePerms[roleId],
        });
      }
      notify(
        'success',
        'Permission Matrix Saved',
        `Updated permissions for ${dirtyRoleIds.length} role(s).`
      );
      setDraftRolePerms({});
      setConfirmMatrixOpen(false);
    } catch (err) {
      notify('error', 'Save Failed', err instanceof Error ? err.message : 'Unable to save roles.');
    } finally {
      setSavingMatrix(false);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization) return;
    if (roleName.trim().length < 2) {
      notify('error', 'Validation Error', 'Role name must be at least 2 characters.');
      return;
    }
    setSavingMatrix(true);
    try {
      await createRole(organization.organizationId, {
        name: roleName.trim(),
        description: roleDesc.trim() || undefined,
        scope: roleScope,
        permissions: ['dashboard.view'],
      });
      notify('success', 'Custom Role Created', `${roleName.trim()} added to matrix.`);
      setCreateOpen(false);
      setRoleName('');
      setRoleDesc('');
    } catch (err) {
      notify('error', 'Create Failed', err instanceof Error ? err.message : 'Failed to create role.');
    } finally {
      setSavingMatrix(false);
    }
  };

  const handleToggleRoleActive = async (role: Role) => {
    if (!organization || !canManageRole) return;
    if (role.roleId === 'role_super_admin') return;
    try {
      await updateRole(role.roleId, organization.organizationId, {
        isActive: !role.isActive,
      });
      notify(
        'info',
        'Role Status Updated',
        `${role.name} is now ${!role.isActive ? 'active' : 'inactive'}.`
      );
    } catch (err) {
      notify('error', 'Update Failed', err instanceof Error ? err.message : 'Failed to update role.');
    }
  };

  const handleDeleteRole = async () => {
    if (!organization || !deleteConfirmRole) return;
    setSavingMatrix(true);
    try {
      await deleteUnusedRole(deleteConfirmRole.roleId, organization.organizationId);
      notify('success', 'Role Deleted', `${deleteConfirmRole.name} removed.`);
      setDeleteConfirmRole(null);
    } catch (err) {
      notify('error', 'Delete Failed', err instanceof Error ? err.message : 'Failed to delete role.');
    } finally {
      setSavingMatrix(false);
    }
  };

  const activeUserForOverride = useMemo(
    () => users.find((u) => u.uid === selectedUid) || users[0] || null,
    [users, selectedUid]
  );

  const currentGranted =
    grantedDraft ?? activeUserForOverride?.grantedPermissions ?? [];
  const currentDenied =
    deniedDraft ?? activeUserForOverride?.deniedPermissions ?? [];

  const setUserOverrideState = (permId: string, state: 'inherit' | 'grant' | 'deny') => {
    const nextGrant = new Set(currentGranted);
    const nextDeny = new Set(currentDenied);
    nextGrant.delete(permId);
    nextDeny.delete(permId);
    if (state === 'grant') nextGrant.add(permId);
    if (state === 'deny') nextDeny.add(permId);
    setGrantedDraft(Array.from(nextGrant));
    setDeniedDraft(Array.from(nextDeny));
  };

  const handleSaveOverrides = async () => {
    if (!organization || !activeUserForOverride) return;
    setSavingMatrix(true);
    try {
      await updateUserAccess(activeUserForOverride.uid, organization.organizationId, {
        grantedPermissions: currentGranted,
        deniedPermissions: currentDenied,
      });
      notify(
        'success',
        'User Permission Overrides Saved',
        `Updated overrides for ${activeUserForOverride.fullName}.`
      );
      setGrantedDraft(null);
      setDeniedDraft(null);
    } catch (err) {
      notify('error', 'Save Failed', err instanceof Error ? err.message : 'Unable to save overrides.');
    } finally {
      setSavingMatrix(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            Roles & Access Control Matrix
          </h2>
          <p className="text-sm text-slate-500">
            Configure organization & branch role policies across all 52 granular permissions and user overrides.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirtyRoleIds.length > 0 && canEditRole && (
            <button
              type="button"
              onClick={() => setConfirmMatrixOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
            >
              <Save className="w-4 h-4" />
              Save Matrix ({dirtyRoleIds.length})
            </button>
          )}
          {canCreateRole && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold"
            >
              <Plus className="w-4 h-4" />
              Create Custom Role
            </button>
          )}
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setTab('matrix')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold ${
            tab === 'matrix'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-700'
          }`}
        >
          <ShieldCheck className="w-4 h-4" /> Role Permission Matrix
        </button>
        {canManageUserOverrides && (
          <button
            type="button"
            onClick={() => setTab('overrides')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold ${
              tab === 'overrides'
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-700'
            }`}
          >
            <UserCog className="w-4 h-4" /> Individual User Overrides
          </button>
        )}
      </div>

      {tab === 'matrix' && (
        <div className="space-y-6">
          {/* Role Summary Strip */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {roles.map((role) => {
              const assignedCount = roleUsageCount.get(role.roleId) || 0;
              return (
                <div
                  key={role.roleId}
                  className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{role.name}</p>
                        <p className="text-xs text-slate-500 capitalize">
                          Scope: {role.scope} · {assignedCount} staff
                        </p>
                      </div>
                      <span
                        className={`text-xs font-semibold ${
                          role.isActive ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {role.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-2 line-clamp-2">{role.description}</p>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <span className="font-mono text-slate-500">
                      {getEffectiveRolePerms(role).size} / {PERMISSION_CATALOG.length} perms
                    </span>
                    <div className="flex items-center gap-2">
                      {canManageRole && role.roleId !== 'role_super_admin' && (
                        <button
                          type="button"
                          onClick={() => void handleToggleRoleActive(role)}
                          className="text-slate-700 hover:underline font-medium"
                        >
                          {role.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                      {canDeleteRole && !role.isSystem && assignedCount === 0 && (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmRole(role)}
                          className="text-rose-600 hover:text-rose-700 p-1"
                          title="Delete unused custom role"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Interactive Matrix Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
                    <th className="py-3 px-4 min-w-[260px]">Module & Permission</th>
                    {roles.map((r) => (
                      <th key={r.roleId} className="py-3 px-4 text-center min-w-[120px]">
                        <div>{r.name}</div>
                        <div className="text-[10px] font-normal text-slate-500">
                          {draftRolePerms[r.roleId] ? 'Modified' : r.scope}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {groupedPermissions.map(([moduleName, perms]) => (
                    <React.Fragment key={moduleName}>
                      <tr className="bg-slate-50/70">
                        <td
                          colSpan={roles.length + 1}
                          className="py-2 px-4 text-xs font-bold text-slate-700"
                        >
                          {moduleName}
                        </td>
                      </tr>
                      {perms.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-4">
                            <p className="font-medium text-slate-900">{p.label}</p>
                            <p className="text-[11px] text-slate-500 font-mono">{p.id}</p>
                          </td>
                          {roles.map((r) => {
                            const checked = getEffectiveRolePerms(r).has(p.id);
                            return (
                              <td key={r.roleId} className="py-2.5 px-4 text-center">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!canEditRole || r.roleId === 'role_super_admin'}
                                  onChange={() => toggleRolePermission(r, p.id)}
                                  className="w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer disabled:opacity-60"
                                  aria-label={`${r.name} ${p.label}`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'overrides' && canManageUserOverrides && activeUserForOverride && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="flex-1 max-w-md">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Select Staff Account
              </label>
              <select
                value={activeUserForOverride.uid}
                onChange={(e) => {
                  setSelectedUid(e.target.value);
                  setGrantedDraft(null);
                  setDeniedDraft(null);
                }}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                {users.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.fullName} ({u.email})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={savingMatrix || (grantedDraft === null && deniedDraft === null)}
              onClick={() => void handleSaveOverrides()}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              {savingMatrix ? 'Saving...' : 'Save User Overrides'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[520px] overflow-y-auto pr-1">
            {PERMISSION_CATALOG.map((p) => {
              const state = currentGranted.includes(p.id)
                ? 'grant'
                : currentDenied.includes(p.id)
                  ? 'deny'
                  : 'inherit';
              return (
                <div
                  key={p.id}
                  className="p-3 border border-slate-200 rounded-lg flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{p.label}</p>
                    <p className="text-[11px] text-slate-500 font-mono truncate">{p.id}</p>
                  </div>
                  <select
                    value={state}
                    onChange={(e) =>
                      setUserOverrideState(
                        p.id,
                        e.target.value as 'inherit' | 'grant' | 'deny'
                      )
                    }
                    className="px-2.5 py-1 text-xs font-medium border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="inherit">Inherit Role</option>
                    <option value="grant">Explicit Grant</option>
                    <option value="deny">Explicit Deny</option>
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create Custom Role Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-4">Create Custom Role</h3>
            <form onSubmit={(e) => void handleCreateRole(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Role Name *
                </label>
                <input
                  type="text"
                  required
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  placeholder="e.g. Inventory Auditor"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Scope</label>
                <select
                  value={roleScope}
                  onChange={(e) => setRoleScope(e.target.value as 'branch' | 'organization')}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="branch">Branch-Scoped</option>
                  <option value="organization">Organization-Wide</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={roleDesc}
                  onChange={(e) => setRoleDesc(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingMatrix}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                >
                  Create Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmMatrixOpen}
        title="Commit Permission Matrix Changes?"
        description={`You are updating permissions for ${dirtyRoleIds.length} role(s). Active staff assigned to these roles will immediately receive the updated permissions.`}
        confirmLabel="Commit Changes"
        loading={savingMatrix}
        onConfirm={() => void handleSaveMatrix()}
        onCancel={() => setConfirmMatrixOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteConfirmRole)}
        title="Delete Custom Role?"
        description={`Delete unused role "${deleteConfirmRole?.name}"? This action cannot be undone.`}
        confirmLabel="Delete Role"
        destructive
        loading={savingMatrix}
        onConfirm={() => void handleDeleteRole()}
        onCancel={() => setDeleteConfirmRole(null)}
      />
    </div>
  );
}
