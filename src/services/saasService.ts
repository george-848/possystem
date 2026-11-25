import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { getPlanById, DEFAULT_SAAS_PLANS } from '../lib/entitlements';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { DEFAULT_ROLE_PRESETS, PERMISSION_CATALOG } from '../lib/permissions';
import { DEFAULT_RECEIPT_VISIBLE_FIELDS } from '../lib/receiptConfig';
import type {
  FeatureKey,
  PlanId,
  PosTerminal,
  QuotaResourceKey,
  TenantMembership,
  UsageTracking,
} from '../types/pos';
import {
  apiRequest,
  cleanOptional,
  isBackendFallbackError,
  makeId,
  recordAuditLog,
} from './auditService';

export interface TenantRegistrationInput {
  businessName: string;
  registrationNumber?: string;
  email?: string;
  phone?: string;
  address?: string;
  country: string;
  currency: string;
  currencySymbol: string;
  timezone: string;
  defaultTaxRateBps: number;
  taxLabel?: string;
  branchName: string;
  branchCity?: string;
  branchRegion?: string;
  branchAddress?: string;
  branchPhone?: string;
  planId?: 'starter' | 'professional';
  seedStarterCategories: boolean;
}

export async function enforceServerEntitlement(params: {
  organizationId: string;
  featureKey?: FeatureKey;
  quotaResource?: QuotaResourceKey;
  increment?: number;
}): Promise<{ allowed: boolean; degradedFallback?: boolean }> {
  if (!auth.currentUser) {
    throw new Error('Authentication required.');
  }

  try {
    await apiRequest<{ allowed: boolean }>('/api/entitlements/enforce', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return { allowed: true };
  } catch (err) {
    // In preview environments without server IAM or when preview proxy returns HTML,
    // allow client-side EntitlementContext + hardened firestore.rules to enforce safely.
    if (isBackendFallbackError(err)) {
      return { allowed: true, degradedFallback: true };
    }
    throw err;
  }
}

export async function registerTenantBusiness(
  input: TenantRegistrationInput
): Promise<{ organizationId: string; branchId: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to register a retail business.');
  }

  // Try authoritative server-side registration first
  try {
    const data = await apiRequest<{
      organizationId: string;
      branchId: string;
    }>('/api/tenants/register', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        planId: input.planId || 'starter',
      }),
    });
    return { organizationId: data.organizationId, branchId: data.branchId };
  } catch (err) {
    if (!isBackendFallbackError(err)) {
      throw err;
    }
  }

  // Atomic client Firestore bootstrap fallback guarded by isBootstrapOrgOwner() in firestore.rules
  const organizationId = makeId('org');
  const branchId = makeId('br');
  const terminalId = makeId('term');
  const settingId = makeId('set');
  const subscriptionId = makeId('sub');
  const membershipId = `${organizationId}_${currentUser.uid}`;
  const selectedPlan = getPlanById(input.planId || 'starter', DEFAULT_SAAS_PLANS);
  const superAdminRoleId = `${organizationId}_role_super_admin`;
  const rawEmail = (input.email?.trim() || currentUser.email || '').toLowerCase();
  const safeEmail =
    rawEmail.length >= 3 ? rawEmail.slice(0, 160) : `${currentUser.uid}@tenant.local`;
  const rawName =
    currentUser.displayName?.trim() ||
    rawEmail.split('@')[0]?.trim() ||
    'Business Owner';
  const fullName = rawName.length >= 2 ? rawName.slice(0, 160) : 'Business Owner';
  const safeTaxRateBps = Math.max(
    0,
    Math.min(5000, Math.round(Number(input.defaultTaxRateBps) || 0))
  );

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const trialEndsAt = new Date(nowMs + (selectedPlan.trialDays || 14) * 86_400_000).toISOString();

  try {
    const existingUserSnap = await getDoc(doc(db, 'users', currentUser.uid));

    // Step 1: Create organization first so isBootstrapOrgOwner(orgId) verifies ownerUid
    await setDoc(
      doc(db, 'organizations', organizationId),
      cleanOptional({
        organizationId,
        businessName: input.businessName.trim().slice(0, 160),
        registrationNumber: input.registrationNumber?.trim().slice(0, 80),
        email: rawEmail || undefined,
        phone: input.phone?.trim().slice(0, 40),
        address: input.address?.trim().slice(0, 300),
        country: input.country.trim().slice(0, 80),
        currency: input.currency.trim().toUpperCase().slice(0, 8),
        currencySymbol: input.currencySymbol.trim().slice(0, 8),
        timezone: input.timezone.trim().slice(0, 80),
        defaultTaxRateBps: safeTaxRateBps,
        taxLabel: (input.taxLabel?.trim() || 'VAT').slice(0, 40),
        allowNegativeInventory: false,
        status: 'active',
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const batch = writeBatch(db);

    // 2. Tenant-scoped RBAC roles
    for (const preset of DEFAULT_ROLE_PRESETS) {
      const scopedRoleId = `${organizationId}_${preset.roleId}`;
      batch.set(doc(db, 'roles', scopedRoleId), {
        roleId: scopedRoleId,
        organizationId,
        name: preset.name,
        description: preset.description,
        scope: preset.scope,
        permissions: preset.permissions,
        isSystem: true,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // 3. Permission definitions
    for (const perm of PERMISSION_CATALOG) {
      const permDocId = `${organizationId}_${perm.id.replace(/\./g, '_')}`;
      batch.set(doc(db, 'permissions', permDocId), {
        permissionId: perm.id,
        organizationId,
        module: perm.module,
        action: perm.action,
        label: perm.label,
        description: perm.description,
      });
    }

    // 4. Primary Branch
    batch.set(
      doc(db, 'branches', branchId),
      cleanOptional({
        branchId,
        organizationId,
        branchCode: 'BR-001',
        branchName: input.branchName.trim().slice(0, 160),
        address: (input.branchAddress?.trim() || input.address?.trim())?.slice(0, 300),
        city: (input.branchCity?.trim() || 'Accra').slice(0, 100),
        region: (input.branchRegion?.trim() || 'Greater Accra').slice(0, 100),
        country: input.country.trim().slice(0, 80),
        contactNumber: (input.branchPhone?.trim() || input.phone?.trim())?.slice(0, 40),
        email: rawEmail ? rawEmail.slice(0, 160) : undefined,
        managerName: fullName.slice(0, 120),
        operatingHours: 'Mon–Sat 08:00–20:00',
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 5. System Settings
    batch.set(doc(db, 'systemSettings', settingId), {
      settingId,
      organizationId,
      receiptHeader: `${input.businessName.trim()} — Official Retail Receipt`.slice(0, 300),
      receiptFooter:
        'Thank you for shopping with us! Goods sold in good condition are returnable per policy.',
      returnPolicy:
        'Returns accepted within 7 days with original receipt and unopened packaging.',
      receiptVisibleFields: DEFAULT_RECEIPT_VISIBLE_FIELDS,
      supportedPaymentMethods: ['cash', 'mobile_money', 'card', 'bank_transfer'],
      maxCashierDiscountPct: 10,
      expenseApprovalLimitMinor: 50000,
      refundWindowDays: 7,
      lowStockNotificationsEnabled: true,
      updatedAt: serverTimestamp(),
    });

    // 6. Trial Subscription
    batch.set(doc(db, 'subscriptions', subscriptionId), {
      subscriptionId,
      tenantId: organizationId,
      planId: selectedPlan.planId as PlanId,
      billingCycle: 'monthly',
      status: 'trial',
      trialEndsAt,
      currentPeriodStart: nowIso,
      currentPeriodEnd: trialEndsAt,
      paymentProvider: 'trial',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 7. SaaS Tenant Document
    batch.set(
      doc(db, 'tenants', organizationId),
      cleanOptional({
        tenantId: organizationId,
        organizationId,
        businessName: input.businessName.trim().slice(0, 160),
        ownerUid: currentUser.uid,
        ownerEmail: safeEmail,
        contactPhone: input.phone?.trim().slice(0, 40),
        country: input.country.trim().slice(0, 80),
        currency: input.currency.trim().toUpperCase().slice(0, 8),
        currencySymbol: input.currencySymbol.trim().slice(0, 8),
        status: 'active',
        currentPlanId: selectedPlan.planId,
        subscriptionId,
        deploymentMode: 'shared',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 8. Membership & Active User Profile
    batch.set(doc(db, 'tenantMemberships', membershipId), {
      membershipId,
      tenantId: organizationId,
      uid: currentUser.uid,
      email: safeEmail,
      fullName,
      roleId: superAdminRoleId,
      branchIds: [branchId],
      defaultBranchId: branchId,
      isOwner: true,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (existingUserSnap.exists()) {
      batch.update(doc(db, 'users', currentUser.uid), {
        organizationId,
        branchIds: [branchId],
        defaultBranchId: branchId,
        roleId: superAdminRoleId,
        grantedPermissions: [],
        deniedPermissions: [],
        lastLogin: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(
        doc(db, 'users', currentUser.uid),
        cleanOptional({
          uid: currentUser.uid,
          fullName,
          email: safeEmail,
          phone: input.phone?.trim().slice(0, 40),
          organizationId,
          branchIds: [branchId],
          defaultBranchId: branchId,
          roleId: superAdminRoleId,
          grantedPermissions: [],
          deniedPermissions: [],
          accountStatus: 'active',
          lastLogin: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }

    // 9. Usage Tracking
    batch.set(doc(db, 'usageTracking', organizationId), {
      tenantId: organizationId,
      branchCount: 1,
      terminalCount: 1,
      staffCount: 1,
      productCount: 0,
      updatedAt: serverTimestamp(),
    });

    // 10. Starter Categories
    if (input.seedStarterCategories) {
      const starterCats = [
        'Beverages & Drinks',
        'Groceries & Pantry',
        'Electronics & Accessories',
        'Personal Care',
        'Household Supplies',
      ];
      for (const name of starterCats) {
        const categoryId = makeId('cat');
        batch.set(doc(db, 'categories', categoryId), {
          categoryId,
          organizationId,
          name,
          description: `${name} retail category`,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();

    // 11. Primary POS Terminal (after branch exists)
    await setDoc(doc(db, 'terminals', terminalId), {
      terminalId,
      organizationId,
      branchId,
      terminalCode: 'POS-01',
      name: 'Front Counter Register 1',
      deviceLabel: 'Primary Web Counter',
      status: 'active',
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await recordAuditLog({
      organizationId,
      branchId,
      action: 'tenant.register',
      resourceType: 'tenant',
      resourceId: organizationId,
      details: `Registered tenant "${input.businessName}" on ${selectedPlan.name} trial`,
    });

    return { organizationId, branchId };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organizations/${organizationId}`);
  }
}

export async function switchActiveTenantMembership(
  membership: TenantMembership
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  if (membership.uid !== currentUser.uid || membership.status !== 'active') {
    throw new Error('Invalid or inactive tenant membership.');
  }

  const path = `users/${currentUser.uid}`;
  try {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      organizationId: membership.tenantId,
      roleId: membership.roleId,
      branchIds: membership.branchIds,
      defaultBranchId: membership.defaultBranchId || membership.branchIds[0] || '',
      grantedPermissions: [],
      deniedPermissions: [],
      lastLogin: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createPosTerminal(params: {
  organizationId: string;
  branchId: string;
  name: string;
  deviceLabel?: string;
  existingCount: number;
}): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');

  try {
    const body = await apiRequest<{ terminal: PosTerminal }>('/api/terminals', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: params.organizationId,
        branchId: params.branchId,
        name: params.name.trim(),
        deviceLabel: params.deviceLabel?.trim() || undefined,
      }),
    });
    return body.terminal.terminalId;
  } catch (err) {
    if (!isBackendFallbackError(err)) {
      throw err;
    }
  }

  // Fallback on preview environments without IAM or HTML proxy responses
  const terminalId = makeId('term');
  const terminalCode = `POS-${String(params.existingCount + 1).padStart(2, '0')}`;
  const path = `terminals/${terminalId}`;
  try {
    await setDoc(
      doc(db, 'terminals', terminalId),
      cleanOptional({
        terminalId,
        organizationId: params.organizationId,
        branchId: params.branchId,
        terminalCode,
        name: params.name.trim(),
        deviceLabel: params.deviceLabel?.trim(),
        status: 'active',
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await recordAuditLog({
      organizationId: params.organizationId,
      branchId: params.branchId,
      action: 'terminal.create',
      resourceType: 'terminal',
      resourceId: terminalId,
      details: `Registered POS terminal ${terminalCode} (${params.name})`,
    });
    return terminalId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updatePosTerminalStatus(params: {
  terminalId: string;
  organizationId: string;
  status: 'active' | 'suspended';
  name?: string;
  deviceLabel?: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');

  try {
    await apiRequest(`/api/terminals/${params.terminalId}`, {
      method: 'POST',
      body: JSON.stringify({
        organizationId: params.organizationId,
        status: params.status,
        ...(params.name ? { name: params.name } : {}),
        ...(params.deviceLabel !== undefined ? { deviceLabel: params.deviceLabel } : {}),
      }),
    });
    return;
  } catch (err) {
    if (!isBackendFallbackError(err)) {
      throw err;
    }
  }

  const path = `terminals/${params.terminalId}`;
  try {
    await updateDoc(doc(db, 'terminals', params.terminalId), {
      status: params.status,
      ...(params.name ? { name: params.name } : {}),
      ...(params.deviceLabel !== undefined ? { deviceLabel: params.deviceLabel } : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function syncTenantUsageSnapshot(usage: UsageTracking): Promise<void> {
  if (!usage.tenantId) return;
  try {
    await setDoc(
      doc(db, 'usageTracking', usage.tenantId),
      {
        tenantId: usage.tenantId,
        branchCount: Math.max(0, usage.branchCount),
        terminalCount: Math.max(0, usage.terminalCount),
        staffCount: Math.max(0, usage.staffCount),
        productCount: Math.max(0, usage.productCount),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch {
    // Non-fatal background counter sync
  }
}

export async function fetchDeploymentMode(): Promise<{
  deploymentMode: 'shared' | 'dedicated';
  dedicatedTenantId: string | null;
  paystackConfigured: boolean;
}> {
  try {
    return await apiRequest('/api/system/deployment-mode');
  } catch {
    return {
      deploymentMode: 'shared',
      dedicatedTenantId: null,
      paystackConfigured: false,
    };
  }
}
