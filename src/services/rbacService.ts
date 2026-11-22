import { sendPasswordResetEmail } from 'firebase/auth';
import {
  deleteDoc,
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  provisionStaffAuthUser,
} from '../lib/firebase';
import type { AccountStatus, Invitation, Role, UserProfile } from '../types/pos';
import { cleanOptional, createNotification, makeId, recordAuditLog } from './auditService';

export async function createRole(
  organizationId: string,
  data: {
    name: string;
    description?: string;
    scope: 'organization' | 'branch';
    permissions: string[];
  }
): Promise<string> {
  const roleId = makeId('role');
  const path = `roles/${roleId}`;
  try {
    await setDoc(
      doc(db, 'roles', roleId),
      cleanOptional({
        roleId,
        organizationId,
        name: data.name.trim(),
        description: data.description?.trim(),
        scope: data.scope,
        permissions: data.permissions,
        isSystem: false,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await recordAuditLog({
      organizationId,
      action: 'role.create',
      resourceType: 'role',
      resourceId: roleId,
      details: `Created custom role "${data.name}" (${data.scope}) with ${data.permissions.length} permissions`,
    });
    return roleId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateRole(
  roleId: string,
  organizationId: string,
  updates: Partial<Pick<Role, 'name' | 'description' | 'scope' | 'permissions' | 'isActive'>>
): Promise<void> {
  const path = `roles/${roleId}`;
  try {
    await updateDoc(doc(db, 'roles', roleId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      organizationId,
      action: 'role.permissions_update',
      resourceType: 'role',
      resourceId: roleId,
      details: `Updated role ${roleId}: ${Object.keys(updates).join(', ')}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteUnusedRole(
  roleId: string,
  organizationId: string
): Promise<void> {
  const path = `roles/${roleId}`;
  try {
    await deleteDoc(doc(db, 'roles', roleId));
    await recordAuditLog({
      organizationId,
      action: 'role.delete',
      resourceType: 'role',
      resourceId: roleId,
      details: `Deleted unused custom role ${roleId}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createInvitation(
  organizationId: string,
  data: {
    email: string;
    fullName: string;
    phone?: string;
    roleId: string;
    branchIds: string[];
    defaultBranchId: string;
  }
): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  const invitationId = makeId('inv');
  const path = `invitations/${invitationId}`;
  try {
    await setDoc(
      doc(db, 'invitations', invitationId),
      cleanOptional({
        invitationId,
        organizationId,
        email: data.email.trim().toLowerCase(),
        fullName: data.fullName.trim(),
        phone: data.phone?.trim(),
        roleId: data.roleId,
        branchIds: data.branchIds,
        defaultBranchId: data.defaultBranchId,
        status: 'pending',
        invitedBy: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await createNotification({
      organizationId,
      branchId: data.defaultBranchId,
      type: 'invitation',
      title: 'Staff Invitation Issued',
      message: `Invitation sent to ${data.fullName} (${data.email}).`,
    });
    await recordAuditLog({
      organizationId,
      branchId: data.defaultBranchId,
      action: 'user.invite',
      resourceType: 'invitation',
      resourceId: invitationId,
      details: `Invited ${data.email} with role ${data.roleId} for branches [${data.branchIds.join(', ')}]`,
    });
    return invitationId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function revokeInvitation(
  invitationId: string,
  organizationId: string
): Promise<void> {
  const path = `invitations/${invitationId}`;
  try {
    await updateDoc(doc(db, 'invitations', invitationId), {
      status: 'revoked',
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      organizationId,
      action: 'user.invitation_revoke',
      resourceType: 'invitation',
      resourceId: invitationId,
      details: `Revoked invitation ${invitationId}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function claimInvitationForCurrentUser(
  invitation: Invitation
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Sign in required to claim invitation.');
  const path = `users/${currentUser.uid}`;
  try {
    await runTransaction(db, async (tx) => {
      const invRef = doc(db, 'invitations', invitation.invitationId);
      const userRef = doc(db, 'users', currentUser.uid);
      const invSnap = await tx.get(invRef);
      if (!invSnap.exists() || invSnap.data().status !== 'pending') {
        throw new Error('This invitation is no longer pending.');
      }

      tx.set(
        userRef,
        cleanOptional({
          uid: currentUser.uid,
          fullName: currentUser.displayName || invitation.fullName,
          email: (currentUser.email || invitation.email).toLowerCase(),
          phone: invitation.phone,
          organizationId: invitation.organizationId,
          branchIds: invitation.branchIds,
          defaultBranchId: invitation.defaultBranchId,
          roleId: invitation.roleId,
          grantedPermissions: [],
          deniedPermissions: [],
          accountStatus: 'active',
          invitationId: invitation.invitationId,
          lastLogin: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      tx.update(invRef, {
        status: 'accepted',
        updatedAt: serverTimestamp(),
      });
    });

    await recordAuditLog({
      organizationId: invitation.organizationId,
      branchId: invitation.defaultBranchId,
      action: 'user.invitation_accepted',
      resourceType: 'user',
      resourceId: currentUser.uid,
      details: `User ${currentUser.email} activated account via invitation ${invitation.invitationId}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function createStaffUserManually(
  organizationId: string,
  data: {
    fullName: string;
    email: string;
    phone?: string;
    password: string;
    roleId: string;
    branchIds: string[];
    defaultBranchId: string;
    accountStatus?: 'active' | 'suspended';
  }
): Promise<{ uid: string; verificationEmailSent: boolean }> {
  const currentAdmin = auth.currentUser;
  if (!currentAdmin) throw new Error('Administrator authentication required.');

  const cleanEmail = data.email.trim().toLowerCase();
  const cleanName = data.fullName.trim();
  const cleanPhone = data.phone?.trim();
  const status: AccountStatus = data.accountStatus === 'suspended' ? 'suspended' : 'active';

  if (cleanName.length < 2) {
    throw new Error('Enter a valid full name (at least 2 characters).');
  }
  if (!cleanEmail.includes('@')) {
    throw new Error('Enter a valid work email address.');
  }
  if (data.password.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }
  if (!data.roleId || data.branchIds.length === 0) {
    throw new Error('Select a role and at least one assigned branch.');
  }

  const defaultBranchId = data.branchIds.includes(data.defaultBranchId)
    ? data.defaultBranchId
    : data.branchIds[0];

  const { uid, verificationEmailSent } = await provisionStaffAuthUser({
    email: cleanEmail,
    password: data.password,
    displayName: cleanName,
    onAuthCreated: async (newUid) => {
      const userPath = `users/${newUid}`;
      try {
        await setDoc(
          doc(db, 'users', newUid),
          cleanOptional({
            uid: newUid,
            fullName: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            organizationId,
            branchIds: data.branchIds,
            defaultBranchId,
            roleId: data.roleId,
            grantedPermissions: [],
            deniedPermissions: [],
            accountStatus: status,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, userPath);
      }
    },
  });

  await Promise.allSettled([
    createNotification({
      organizationId,
      branchId: defaultBranchId,
      type: 'invitation',
      title: 'Staff Account Created',
      message: `Manual account provisioned for ${cleanName} (${cleanEmail}).`,
    }),
    recordAuditLog({
      organizationId,
      branchId: defaultBranchId,
      action: 'user.create',
      resourceType: 'user',
      resourceId: uid,
      details: `Created staff account for ${cleanEmail} with role ${data.roleId} (${status}) for branches [${data.branchIds.join(', ')}]`,
    }),
  ]);

  return { uid, verificationEmailSent };
}

export async function sendStaffPasswordReset(email: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail.includes('@')) {
    throw new Error('Valid email address required.');
  }
  await sendPasswordResetEmail(auth, cleanEmail);
}

export async function updateUserAccess(
  targetUid: string,
  organizationId: string,
  updates: Partial<
    Pick<
      UserProfile,
      | 'fullName'
      | 'phone'
      | 'branchIds'
      | 'defaultBranchId'
      | 'roleId'
      | 'grantedPermissions'
      | 'deniedPermissions'
      | 'accountStatus'
    >
  >
): Promise<void> {
  const path = `users/${targetUid}`;
  try {
    await updateDoc(doc(db, 'users', targetUid), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    const action =
      updates.accountStatus === 'suspended'
        ? 'user.suspend'
        : updates.accountStatus === 'active'
          ? 'user.activate'
          : 'user.access_update';
    await recordAuditLog({
      organizationId,
      action,
      resourceType: 'user',
      resourceId: targetUid,
      details: `Updated user ${targetUid}: ${Object.keys(updates).join(', ')}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function recordUserLastLogin(
  uid: string,
  organizationId: string,
  defaultBranchId?: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      lastLogin: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      organizationId,
      branchId: defaultBranchId,
      action: 'auth.login_success',
      resourceType: 'user',
      resourceId: uid,
      details: 'Verified session sign-in',
    });
  } catch {
    // Non-fatal if user is suspended or rules reject
  }
}

export function getStatusBadgeStyle(status: AccountStatus | string): string {
  switch (status) {
    case 'active':
    case 'completed':
    case 'approved':
    case 'received':
    case 'processed':
    case 'paid':
      return 'text-emerald-700';
    case 'pending':
    case 'pending_approval':
    case 'dispatched':
    case 'partially_received':
    case 'open':
    case 'draft':
      return 'text-amber-700';
    case 'suspended':
    case 'rejected':
    case 'cancelled':
    case 'revoked':
      return 'text-rose-700';
    default:
      return 'text-slate-600';
  }
}
