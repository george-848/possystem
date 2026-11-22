import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Edit2,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  MailPlus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime } from '../lib/money';
import { apiRequest } from '../services/auditService';
import {
  createInvitation,
  createStaffUserManually,
  revokeInvitation,
  sendStaffPasswordReset,
  updateUserAccess,
} from '../services/rbacService';
import type { Invitation, UserProfile } from '../types/pos';

function generateTemporaryPassword(length = 12): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = upper + lower + digits + symbols;

  const bytes = new Uint32Array(length);
  window.crypto.getRandomValues(bytes);

  const chars = [
    upper[bytes[0] % upper.length],
    lower[bytes[1] % lower.length],
    digits[bytes[2] % digits.length],
    symbols[bytes[3] % symbols.length],
  ];

  for (let i = 4; i < length; i++) {
    chars.push(all[bytes[i] % all.length]);
  }

  // Deterministic Fisher-Yates shuffle using fresh random bytes
  const shuffleBytes = new Uint32Array(length);
  window.crypto.getRandomValues(shuffleBytes);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return chars.join('');
}

export default function UsersPage() {
  const { organization, branches, userProfile, hasPermission } = useAuth();
  const { users, invitations, roles } = useData();
  const { notify } = useToast();

  const canCreate = hasPermission('users.create');
  const canEdit = hasPermission('users.edit');
  const canSuspend = hasPermission('users.suspend');

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [confirmSuspendUser, setConfirmSuspendUser] = useState<UserProfile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [createdCredentialsModal, setCreatedCredentialsModal] = useState<{
    fullName: string;
    email: string;
    password: string;
    roleName: string;
    branchSummary: string;
    accountStatus: 'active' | 'suspended';
    verificationEmailSent: boolean;
  } | null>(null);

  const [shareModal, setShareModal] = useState<{
    invitationId: string;
    fullName: string;
    email: string;
    roleName: string;
    branchSummary: string;
    inviteUrl: string;
    emailed: boolean;
    reason?: string;
  } | null>(null);

  // Manual user creation form state
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newRoleId, setNewRoleId] = useState('');
  const [newBranchIds, setNewBranchIds] = useState<string[]>([]);
  const [newDefaultBranchId, setNewDefaultBranchId] = useState('');
  const [newAccountStatus, setNewAccountStatus] = useState<'active' | 'suspended'>('active');

  // Optional Google invite link form state
  const [invFullName, setInvFullName] = useState('');
  const [invEmail, setInvEmail] = useState('');
  const [invPhone, setInvPhone] = useState('');
  const [invRoleId, setInvRoleId] = useState('');
  const [invBranchIds, setInvBranchIds] = useState<string[]>([]);
  const [invDefaultBranchId, setInvDefaultBranchId] = useState('');

  // Edit user state
  const [editRoleId, setEditRoleId] = useState('');
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [editDefaultBranchId, setEditDefaultBranchId] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');

  const roleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roles) map.set(r.roleId, r.name);
    return map;
  }, [roles]);

  const branchMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of branches) map.set(b.branchId, `${b.branchCode} · ${b.branchName}`);
    return map;
  }, [branches]);

  const activeRoles = useMemo(() => roles.filter((r) => r.isActive), [roles]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone || '').toLowerCase().includes(q) ||
        (roleMap.get(u.roleId) || '').toLowerCase().includes(q)
      );
    });
  }, [users, search, roleMap]);

  const openCreateModal = () => {
    const defaultRole = activeRoles.find((r) => r.roleId === 'role_cashier') || activeRoles[0];
    const firstBranch = branches[0]?.branchId || '';
    setNewFullName('');
    setNewEmail('');
    setNewPhone('');
    setNewPassword(generateTemporaryPassword());
    setShowNewPassword(true);
    setNewRoleId(defaultRole?.roleId || '');
    setNewBranchIds(firstBranch ? [firstBranch] : []);
    setNewDefaultBranchId(firstBranch);
    setNewAccountStatus('active');
    setCreateOpen(true);
  };

  const toggleNewBranch = (branchId: string) => {
    setNewBranchIds((prev) => {
      const next = prev.includes(branchId)
        ? prev.filter((id) => id !== branchId)
        : [...prev, branchId];
      if (!next.includes(newDefaultBranchId)) {
        setNewDefaultBranchId(next[0] || '');
      }
      return next;
    });
  };

  const handleCreateManualUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization) return;

    const cleanEmail = newEmail.trim().toLowerCase();
    if (!cleanEmail.includes('@') || newFullName.trim().length < 2) {
      notify('error', 'Invalid Details', 'Enter a valid full name and work email address.');
      return;
    }
    if (newPassword.length < 8) {
      notify('error', 'Password Too Short', 'Assign a password of at least 8 characters.');
      return;
    }
    if (!newRoleId || newBranchIds.length === 0) {
      notify('error', 'Missing Assignment', 'Select a role and at least one branch.');
      return;
    }

    setSubmitting(true);
    try {
      const defaultBranchId = newBranchIds.includes(newDefaultBranchId)
        ? newDefaultBranchId
        : newBranchIds[0];

      const { verificationEmailSent } = await createStaffUserManually(organization.organizationId, {
        fullName: newFullName.trim(),
        email: cleanEmail,
        phone: newPhone.trim() || undefined,
        password: newPassword,
        roleId: newRoleId,
        branchIds: newBranchIds,
        defaultBranchId,
        accountStatus: newAccountStatus,
      });

      const roleName = roleMap.get(newRoleId) || newRoleId;
      const branchSummary = newBranchIds.map((id) => branchMap.get(id) || id).join(', ');

      setCreateOpen(false);
      setCreatedCredentialsModal({
        fullName: newFullName.trim(),
        email: cleanEmail,
        password: newPassword,
        roleName,
        branchSummary,
        accountStatus: newAccountStatus,
        verificationEmailSent,
      });
      notify('success', 'Staff Account Created', `${newFullName.trim()} can now sign in with their email & password.`);
    } catch (err) {
      notify(
        'error',
        'Account Creation Failed',
        err instanceof Error ? err.message : 'Unable to create staff account.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const copyCreatedCredentials = async () => {
    if (!createdCredentialsModal) return;
    const text =
      `LedgerBranch POS Login Credentials\n` +
      `Staff Name: ${createdCredentialsModal.fullName}\n` +
      `Work Email: ${createdCredentialsModal.email}\n` +
      `Password: ${createdCredentialsModal.password}\n` +
      `Role: ${createdCredentialsModal.roleName}\n` +
      `Branch Access: ${createdCredentialsModal.branchSummary}\n` +
      `Login URL: ${window.location.origin}/login`;
    try {
      await navigator.clipboard.writeText(text);
      notify('success', 'Credentials Copied', 'Share these sign-in details securely with your staff member.');
    } catch {
      notify('error', 'Copy Failed', 'Copy the email and password manually from the dialog.');
    }
  };

  const openInviteModal = () => {
    const defaultRole = activeRoles.find((r) => r.roleId === 'role_cashier') || activeRoles[0];
    const firstBranch = branches[0]?.branchId || '';
    setInvFullName('');
    setInvEmail('');
    setInvPhone('');
    setInvRoleId(defaultRole?.roleId || '');
    setInvBranchIds(firstBranch ? [firstBranch] : []);
    setInvDefaultBranchId(firstBranch);
    setInviteOpen(true);
  };

  const toggleInviteBranch = (branchId: string) => {
    setInvBranchIds((prev) => {
      const next = prev.includes(branchId)
        ? prev.filter((id) => id !== branchId)
        : [...prev, branchId];
      if (!next.includes(invDefaultBranchId)) {
        setInvDefaultBranchId(next[0] || '');
      }
      return next;
    });
  };

  const buildInviteUrl = (invitationId: string, email: string) =>
    `${window.location.origin}/login?invite=${encodeURIComponent(invitationId)}&email=${encodeURIComponent(email)}`;

  const buildMailtoHref = (params: {
    email: string;
    fullName: string;
    roleName: string;
    branchSummary: string;
    inviteUrl: string;
  }) => {
    const orgName = organization?.businessName || 'LedgerBranch POS';
    const subject = encodeURIComponent(`Staff Invitation: Join ${orgName} on LedgerBranch POS`);
    const body = encodeURIComponent(
      `Hello ${params.fullName},\n\n` +
        `You have been invited to join ${orgName} on LedgerBranch POS.\n` +
        `Role: ${params.roleName}\n` +
        `Branch Access: ${params.branchSummary}\n\n` +
        `Open this link and sign in with Google using your email (${params.email}) to activate your account:\n` +
        `${params.inviteUrl}\n`
    );
    return `mailto:${encodeURIComponent(params.email)}?subject=${subject}&body=${body}`;
  };

  const copyInviteLink = async (invitationId: string, inviteUrl: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedId(invitationId);
      setTimeout(() => setCopiedId((prev) => (prev === invitationId ? null : prev)), 2500);
      notify('success', 'Invite Link Copied', 'Share this link with your staff member.');
    } catch {
      notify('error', 'Copy Failed', 'Copy the invitation URL manually from the box.');
    }
  };

  const trySendInviteEmail = async (params: {
    invitationId: string;
    email: string;
    fullName: string;
    roleName: string;
    branchSummary: string;
    inviteUrl: string;
  }): Promise<{ emailed: boolean; reason?: string }> => {
    try {
      return await apiRequest<{ emailed: boolean; reason?: string }>(
        '/api/invitations/send-email',
        {
          method: 'POST',
          body: JSON.stringify({
            invitationId: params.invitationId,
            recipientEmail: params.email,
            recipientName: params.fullName,
            organizationName: organization?.businessName || 'LedgerBranch POS',
            roleName: params.roleName,
            branchSummary: params.branchSummary,
            inviteUrl: params.inviteUrl,
          }),
        }
      );
    } catch (err) {
      return {
        emailed: false,
        reason: err instanceof Error ? err.message : 'Unable to send email automatically.',
      };
    }
  };

  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization) return;
    const cleanEmail = invEmail.trim().toLowerCase();
    if (!cleanEmail.includes('@') || invFullName.trim().length < 2) {
      notify('error', 'Invalid Details', 'Enter a valid full name and staff email.');
      return;
    }
    if (!invRoleId || invBranchIds.length === 0) {
      notify('error', 'Missing Assignment', 'Select a role and at least one assigned branch.');
      return;
    }

    setSubmitting(true);
    try {
      const invitationId = await createInvitation(organization.organizationId, {
        email: cleanEmail,
        fullName: invFullName.trim(),
        phone: invPhone.trim() || undefined,
        roleId: invRoleId,
        branchIds: invBranchIds,
        defaultBranchId: invDefaultBranchId || invBranchIds[0],
      });

      const roleName = roleMap.get(invRoleId) || invRoleId;
      const branchSummary = invBranchIds.map((id) => branchMap.get(id) || id).join(', ');
      const inviteUrl = buildInviteUrl(invitationId, cleanEmail);

      const emailResult = await trySendInviteEmail({
        invitationId,
        email: cleanEmail,
        fullName: invFullName.trim(),
        roleName,
        branchSummary,
        inviteUrl,
      });

      setInviteOpen(false);
      if (emailResult.emailed) {
        notify(
          'success',
          'Invitation Email Sent',
          `An onboarding email was sent to ${cleanEmail}.`
        );
      } else {
        setShareModal({
          invitationId,
          fullName: invFullName.trim(),
          email: cleanEmail,
          roleName,
          branchSummary,
          inviteUrl,
          emailed: false,
          reason: emailResult.reason,
        });
      }
    } catch (err) {
      notify('error', 'Invite Failed', err instanceof Error ? err.message : 'Unable to create invite.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOrShare = async (inv: Invitation) => {
    const roleName = roleMap.get(inv.roleId) || inv.roleId;
    const branchSummary = inv.branchIds.map((id) => branchMap.get(id) || id).join(', ');
    const inviteUrl = buildInviteUrl(inv.invitationId, inv.email);
    setSubmitting(true);
    try {
      const emailResult = await trySendInviteEmail({
        invitationId: inv.invitationId,
        email: inv.email,
        fullName: inv.fullName,
        roleName,
        branchSummary,
        inviteUrl,
      });
      if (emailResult.emailed) {
        notify('success', 'Invitation Email Sent', `Email delivered to ${inv.email}.`);
      } else {
        setShareModal({
          invitationId: inv.invitationId,
          fullName: inv.fullName,
          email: inv.email,
          roleName,
          branchSummary,
          inviteUrl,
          emailed: false,
          reason: emailResult.reason,
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const openEditUser = (u: UserProfile) => {
    setEditingUser(u);
    setEditFullName(u.fullName);
    setEditPhone(u.phone || '');
    setEditRoleId(u.roleId);
    setEditBranchIds(u.branchIds);
    setEditDefaultBranchId(u.defaultBranchId || u.branchIds[0] || '');
  };

  const handleSaveUserEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !editingUser) return;
    if (editBranchIds.length === 0) {
      notify('error', 'Branch Required', 'Assign at least one branch.');
      return;
    }

    setSubmitting(true);
    try {
      await updateUserAccess(editingUser.uid, organization.organizationId, {
        fullName: editFullName.trim(),
        phone: editPhone.trim(),
        roleId: editRoleId,
        branchIds: editBranchIds,
        defaultBranchId: editBranchIds.includes(editDefaultBranchId)
          ? editDefaultBranchId
          : editBranchIds[0],
      });
      notify('success', 'User Access Updated', `${editFullName.trim()} updated.`);
      setEditingUser(null);
    } catch (err) {
      notify('error', 'Update Failed', err instanceof Error ? err.message : 'Unable to update user.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendPasswordReset = async (email: string) => {
    setResettingPassword(true);
    try {
      await sendStaffPasswordReset(email);
      notify(
        'success',
        'Password Reset Sent',
        `A Firebase password reset email was triggered for ${email}.`
      );
    } catch (err) {
      notify(
        'error',
        'Reset Failed',
        err instanceof Error ? err.message : 'Unable to send password reset email.'
      );
    } finally {
      setResettingPassword(false);
    }
  };

  const handleToggleSuspend = async () => {
    if (!organization || !confirmSuspendUser) return;
    setSubmitting(true);
    try {
      const nextStatus =
        confirmSuspendUser.accountStatus === 'active' ? 'suspended' : 'active';
      await updateUserAccess(confirmSuspendUser.uid, organization.organizationId, {
        accountStatus: nextStatus,
      });
      notify(
        'info',
        `Account ${nextStatus === 'suspended' ? 'Suspended' : 'Activated'}`,
        `${confirmSuspendUser.fullName} is now ${nextStatus}.`
      );
      setConfirmSuspendUser(null);
    } catch (err) {
      notify('error', 'Action Failed', err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeInvite = async (invitationId: string) => {
    if (!organization) return;
    try {
      await revokeInvitation(invitationId, organization.organizationId);
      notify('info', 'Invitation Revoked', 'Pending invitation can no longer be claimed.');
    } catch (err) {
      notify('error', 'Revoke Failed', err instanceof Error ? err.message : 'Failed to revoke invite.');
    }
  };

  const pendingInvites = invitations.filter((i) => i.status === 'pending');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">
            Staff Accounts & Access
          </h2>
          <p className="text-sm text-slate-500">
            Create staff accounts manually with login passwords, role permissions, branch access, and status controls.
          </p>
        </div>
        {canCreate && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold whitespace-nowrap shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              Create Staff User
            </button>
            <button
              type="button"
              onClick={openInviteModal}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium whitespace-nowrap shrink-0"
            >
              <MailPlus className="w-4 h-4 text-slate-500" />
              Google Invite Link
            </button>
          </div>
        )}
      </div>

      {/* Pending Google Invite Links (if any exist) */}
      {pendingInvites.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <MailPlus className="w-4 h-4 text-emerald-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Pending Google Invite Links ({pendingInvites.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingInvites.map((inv) => {
              const inviteUrl = buildInviteUrl(inv.invitationId, inv.email);
              const isCopied = copiedId === inv.invitationId;
              return (
                <div
                  key={inv.invitationId}
                  className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      {inv.fullName}{' '}
                      <span className="font-normal text-slate-500 font-mono">({inv.email})</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Role: {roleMap.get(inv.roleId) || inv.roleId} · Branches:{' '}
                      {inv.branchIds.map((id) => branchMap.get(id) || id).join(', ')}
                    </p>
                  </div>
                  {canCreate && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void copyInviteLink(inv.invitationId, inviteUrl)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" /> Copy Link
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleResendOrShare(inv)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                      >
                        <Send className="w-3.5 h-3.5" /> Share
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRevokeInvite(inv.invitationId)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Revoke
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff by name, email, phone, or assigned role..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>
      </div>

      {/* Staff Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Assigned Branches</th>
                <th className="py-3 px-4">Overrides</th>
                <th className="py-3 px-4">Last Verified Login</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredUsers.map((u) => {
                const isSelf = u.uid === userProfile?.uid;
                const overrideCount =
                  (u.grantedPermissions?.length || 0) + (u.deniedPermissions?.length || 0);
                return (
                  <tr key={u.uid} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">
                        {u.fullName}{' '}
                        {isSelf && <span className="text-xs text-emerald-700">(You)</span>}
                      </p>
                      <p className="text-xs text-slate-500 font-mono">{u.email}</p>
                      {u.phone && <p className="text-[11px] text-slate-400 font-mono">{u.phone}</p>}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800">
                      {roleMap.get(u.roleId) || u.roleId}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 max-w-[240px]">
                      {u.branchIds.map((id) => branchMap.get(id) || id).join(', ') || 'Org-wide'}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-600">
                      {overrideCount > 0
                        ? `+${u.grantedPermissions?.length || 0} / -${u.deniedPermissions?.length || 0}`
                        : 'Role default'}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-500">
                      {formatDateTime(u.lastLogin)}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-semibold capitalize ${
                          u.accountStatus === 'active' ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {u.accountStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openEditUser(u)}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
                            title="Edit details, role & branch access"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canSuspend && !isSelf && (
                          <button
                            type="button"
                            onClick={() => setConfirmSuspendUser(u)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                              u.accountStatus === 'active'
                                ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                                : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                            }`}
                          >
                            {u.accountStatus === 'active' ? 'Suspend' : 'Activate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Staff User Manually Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 mb-1">Create Staff User</h3>
            <p className="text-xs text-slate-500 mb-4">
              Provision a staff account directly with an assigned login password, role, and branch permissions.
            </p>
            <form onSubmit={(e) => void handleCreateManualUser(e)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    placeholder="e.g. Ama Mensah"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="+233 24 000 0000"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Work Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  placeholder="cashier@company.com"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Login Password * <span className="font-normal text-slate-400">(min 8 chars)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setNewPassword(generateTemporaryPassword());
                      setShowNewPassword(true);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Generate strong password
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full pl-3 pr-10 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                    placeholder="Assign initial password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    title={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Assigned Role *
                  </label>
                  <select
                    value={newRoleId}
                    onChange={(e) => setNewRoleId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {activeRoles.map((r) => (
                      <option key={r.roleId} value={r.roleId}>
                        {r.name} ({r.scope})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Account Status
                  </label>
                  <select
                    value={newAccountStatus}
                    onChange={(e) =>
                      setNewAccountStatus(e.target.value === 'suspended' ? 'suspended' : 'active')
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="active">Active (Immediate Login)</option>
                    <option value="suspended">Suspended (Disabled)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Authorized Branches *
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                  {branches.map((b) => (
                    <label key={b.branchId} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={newBranchIds.includes(b.branchId)}
                        onChange={() => toggleNewBranch(b.branchId)}
                        className="rounded border-slate-300 text-emerald-600"
                      />
                      <span>
                        {b.branchCode} — {b.branchName}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {newBranchIds.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Default Branch
                  </label>
                  <select
                    value={newDefaultBranchId}
                    onChange={(e) => setNewDefaultBranchId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {newBranchIds.map((id) => (
                      <option key={id} value={id}>
                        {branchMap.get(id) || id}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-relaxed">
                Staff sign in immediately on the login page using <strong>Work Email + Password</strong>.
                Passwords are stored securely in Firebase Authentication and never written to Firestore.
              </p>

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
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {submitting ? 'Creating Account...' : 'Create Staff Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* One-Time Credentials Confirmation Modal */}
      {createdCredentialsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Staff Account Ready</h3>
                <p className="text-xs text-slate-500">
                  Save or share these credentials now — the password is hidden once you close this dialog.
                </p>
              </div>
            </div>

            <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Staff Name</span>
                <span className="font-semibold text-slate-900">{createdCredentialsModal.fullName}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Work Email</span>
                <span className="font-mono font-semibold text-slate-900">
                  {createdCredentialsModal.email}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Password</span>
                <span className="font-mono font-bold text-emerald-800 select-all">
                  {createdCredentialsModal.password}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Role</span>
                <span className="font-medium text-slate-800">{createdCredentialsModal.roleName}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Branches</span>
                <span className="font-medium text-slate-800 text-right">
                  {createdCredentialsModal.branchSummary}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Account Status</span>
                <span className="font-semibold capitalize text-slate-900">
                  {createdCredentialsModal.accountStatus}
                </span>
              </div>
            </div>

            {createdCredentialsModal.verificationEmailSent && (
              <p className="mt-3 text-[11px] text-slate-500">
                A verification email was also dispatched, though this user can sign in immediately with email &amp; password.
              </p>
            )}

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => void copyCreatedCredentials()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                <Copy className="w-4 h-4" />
                Copy Login Details
              </button>
              <button
                type="button"
                onClick={() => setCreatedCredentialsModal(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Optional Google Invite Link Modal */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 mb-1">Issue Google Invite Link</h3>
            <p className="text-xs text-slate-500 mb-4">
              Optional onboarding link for staff who will sign in with their own Google account instead of a manual password.
            </p>
            <form onSubmit={(e) => void handleCreateInvitation(e)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={invFullName}
                    onChange={(e) => setInvFullName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="text"
                    value={invPhone}
                    onChange={(e) => setInvPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Staff Google Email *
                </label>
                <input
                  type="email"
                  required
                  value={invEmail}
                  onChange={(e) => setInvEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  placeholder="staff@gmail.com"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assigned Role *
                </label>
                <select
                  value={invRoleId}
                  onChange={(e) => setInvRoleId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  {activeRoles.map((r) => (
                    <option key={r.roleId} value={r.roleId}>
                      {r.name} ({r.scope})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Authorized Branches *
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                  {branches.map((b) => (
                    <label key={b.branchId} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={invBranchIds.includes(b.branchId)}
                        onChange={() => toggleInviteBranch(b.branchId)}
                        className="rounded border-slate-300 text-emerald-600"
                      />
                      <span>
                        {b.branchCode} — {b.branchName}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              {invBranchIds.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Default Branch
                  </label>
                  <select
                    value={invDefaultBranchId}
                    onChange={(e) => setInvDefaultBranchId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {invBranchIds.map((id) => (
                      <option key={id} value={id}>
                        {branchMap.get(id) || id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                >
                  {submitting ? 'Generating...' : 'Create Invite Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 mb-4">
              Edit Staff Access — {editingUser.email}
            </h3>
            <form onSubmit={(e) => void handleSaveUserEdit(e)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
                <select
                  value={editRoleId}
                  onChange={(e) => setEditRoleId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  {activeRoles.map((r) => (
                    <option key={r.roleId} value={r.roleId}>
                      {r.name} ({r.scope})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Assigned Branches
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                  {branches.map((b) => (
                    <label key={b.branchId} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={editBranchIds.includes(b.branchId)}
                        onChange={() =>
                          setEditBranchIds((prev) =>
                            prev.includes(b.branchId)
                              ? prev.filter((id) => id !== b.branchId)
                              : [...prev, b.branchId]
                          )
                        }
                      />
                      <span>
                        {b.branchCode} — {b.branchName}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              {editBranchIds.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Default Branch
                  </label>
                  <select
                    value={editDefaultBranchId}
                    onChange={(e) => setEditDefaultBranchId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {editBranchIds.map((id) => (
                      <option key={id} value={id}>
                        {branchMap.get(id) || id}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={resettingPassword}
                  onClick={() => void handleSendPasswordReset(editingUser.email)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                  {resettingPassword ? 'Sending Reset...' : 'Send Password Reset Email'}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingUser(null)}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                  >
                    {submitting ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Invitation Link / Email Fallback Modal */}
      {shareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Google Invite Link Ready
            </h3>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              The onboarding link for <strong>{shareModal.fullName}</strong> (
              <span className="font-mono">{shareModal.email}</span>) is saved.
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 space-y-2">
              <p className="text-xs font-semibold text-slate-700">
                1. Share this onboarding link with {shareModal.fullName}:
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareModal.inviteUrl}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-700"
                />
                <button
                  type="button"
                  onClick={() => void copyInviteLink(shareModal.invitationId, shareModal.inviteUrl)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                2. Ask them to click <strong>Sign In with Google</strong> using{' '}
                <span className="font-mono text-slate-700">{shareModal.email}</span> to claim their
                role ({shareModal.roleName}) immediately.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <a
                href={buildMailtoHref(shareModal)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                <Mail className="w-4 h-4" />
                Open Email Draft
              </a>
              <button
                type="button"
                onClick={() => setShareModal(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmSuspendUser)}
        title={
          confirmSuspendUser?.accountStatus === 'active'
            ? 'Suspend Staff Account?'
            : 'Reactivate Staff Account?'
        }
        description={
          confirmSuspendUser?.accountStatus === 'active'
            ? `Suspending ${confirmSuspendUser?.fullName} immediately revokes all POS, inventory, and API access.`
            : `Restore active access for ${confirmSuspendUser?.fullName}.`
        }
        confirmLabel={
          confirmSuspendUser?.accountStatus === 'active' ? 'Suspend Account' : 'Activate Account'
        }
        destructive={confirmSuspendUser?.accountStatus === 'active'}
        loading={submitting}
        onConfirm={() => void handleToggleSuspend()}
        onCancel={() => setConfirmSuspendUser(null)}
      />
    </div>
  );
}
