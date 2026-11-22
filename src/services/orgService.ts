import {
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { DEFAULT_ROLE_PRESETS, PERMISSION_CATALOG } from '../lib/permissions';
import { DEFAULT_RECEIPT_VISIBLE_FIELDS } from '../lib/receiptConfig';
import type { Branch, Organization, SystemSettings } from '../types/pos';
import { cleanOptional, makeId, recordAuditLog } from './auditService';

export interface BootstrapOrgInput {
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
  seedStarterCategories: boolean;
}

export async function bootstrapOrganizationSetup(
  input: BootstrapOrgInput
): Promise<{ organizationId: string; branchId: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('You must be signed in to set up the organization.');

  const organizationId = makeId('org');
  const branchId = makeId('br');
  const settingId = makeId('set');

  try {
    // Create organization first so subsequent security rules verify exists(orgPath)
    await setDoc(
      doc(db, 'organizations', organizationId),
      cleanOptional({
        organizationId,
        businessName: input.businessName.trim(),
        registrationNumber: input.registrationNumber?.trim(),
        email: input.email?.trim() || currentUser.email || undefined,
        phone: input.phone?.trim(),
        address: input.address?.trim(),
        country: input.country.trim(),
        currency: input.currency.trim(),
        currencySymbol: input.currencySymbol.trim(),
        timezone: input.timezone.trim(),
        defaultTaxRateBps: input.defaultTaxRateBps,
        taxLabel: input.taxLabel?.trim() || 'VAT',
        allowNegativeInventory: false,
        status: 'active',
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const batch = writeBatch(db);

    // 1. Default RBAC Roles
    for (const preset of DEFAULT_ROLE_PRESETS) {
      batch.set(doc(db, 'roles', preset.roleId), {
        roleId: preset.roleId,
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

    // 2. Permission catalog
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

    // 3. Head Office / Primary Retail Branch
    batch.set(
      doc(db, 'branches', branchId),
      cleanOptional({
        branchId,
        organizationId,
        branchCode: 'BR-001',
        branchName: input.branchName.trim(),
        address: input.branchAddress?.trim() || input.address?.trim(),
        city: input.branchCity?.trim() || 'Accra',
        region: input.branchRegion?.trim() || 'Greater Accra',
        country: input.country.trim(),
        contactNumber: input.branchPhone?.trim() || input.phone?.trim(),
        email: input.email?.trim() || currentUser.email || undefined,
        managerName: currentUser.displayName || currentUser.email || 'Head Office Admin',
        operatingHours: 'Mon–Sat 08:00–20:00',
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 4. Default System Settings
    batch.set(doc(db, 'systemSettings', settingId), {
      settingId,
      organizationId,
      receiptHeader: `${input.businessName.trim()} — Official Retail Receipt`,
      receiptFooter: 'Thank you for shopping with us! Goods sold in good condition are returnable per policy.',
      returnPolicy: 'Returns accepted within 7 days with original receipt and unopened packaging.',
      receiptVisibleFields: DEFAULT_RECEIPT_VISIBLE_FIELDS,
      supportedPaymentMethods: ['cash', 'mobile_money', 'card', 'bank_transfer'],
      maxCashierDiscountPct: 10,
      expenseApprovalLimitMinor: 50000, // GH₵500.00
      refundWindowDays: 7,
      lowStockNotificationsEnabled: true,
      updatedAt: serverTimestamp(),
    });

    // 5. Super Admin User Profile
    batch.set(
      doc(db, 'users', currentUser.uid),
      cleanOptional({
        uid: currentUser.uid,
        fullName: currentUser.displayName || 'Super Administrator',
        email: currentUser.email || '',
        phone: input.phone?.trim(),
        organizationId,
        branchIds: [branchId],
        defaultBranchId: branchId,
        roleId: 'role_super_admin',
        grantedPermissions: [],
        deniedPermissions: [],
        accountStatus: 'active',
        lastLogin: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 6. Optional starter retail categories
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

    await recordAuditLog({
      organizationId,
      branchId,
      action: 'organization.bootstrap',
      resourceType: 'organization',
      resourceId: organizationId,
      details: `Bootstrapped organization "${input.businessName}" with primary branch BR-001`,
    });

    return { organizationId, branchId };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organizations/${organizationId}`);
  }
}

export async function updateOrganization(
  organizationId: string,
  updates: Partial<
    Pick<
      Organization,
      | 'businessName'
      | 'registrationNumber'
      | 'logoUrl'
      | 'email'
      | 'phone'
      | 'address'
      | 'country'
      | 'currency'
      | 'currencySymbol'
      | 'timezone'
      | 'defaultTaxRateBps'
      | 'taxLabel'
      | 'allowNegativeInventory'
      | 'status'
    >
  >
): Promise<void> {
  const path = `organizations/${organizationId}`;
  try {
    await updateDoc(doc(db, 'organizations', organizationId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      organizationId,
      action: 'organization.update',
      resourceType: 'organization',
      resourceId: organizationId,
      details: `Updated organization configuration: ${Object.keys(updates).join(', ')}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateSystemSettings(
  settingId: string,
  organizationId: string,
  updates: Omit<SystemSettings, 'settingId' | 'organizationId' | 'updatedAt'>
): Promise<void> {
  const path = `systemSettings/${settingId}`;
  try {
    await updateDoc(doc(db, 'systemSettings', settingId), {
      ...cleanOptional(updates),
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      organizationId,
      action: 'settings.update',
      resourceType: 'systemSettings',
      resourceId: settingId,
      details: 'Updated system, receipt, payment, or approval settings',
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createBranch(
  organizationId: string,
  existingBranchesCount: number,
  data: Omit<Branch, 'branchId' | 'organizationId' | 'branchCode' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const branchId = makeId('br');
  const branchCode = `BR-${String(existingBranchesCount + 1).padStart(3, '0')}`;
  const path = `branches/${branchId}`;
  try {
    await setDoc(
      doc(db, 'branches', branchId),
      cleanOptional({
        branchId,
        organizationId,
        branchCode,
        branchName: data.branchName.trim(),
        address: data.address?.trim(),
        city: data.city?.trim(),
        region: data.region?.trim(),
        country: data.country?.trim(),
        contactNumber: data.contactNumber?.trim(),
        email: data.email?.trim(),
        managerName: data.managerName?.trim(),
        operatingHours: data.operatingHours?.trim(),
        status: data.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await recordAuditLog({
      organizationId,
      branchId,
      action: 'branch.create',
      resourceType: 'branch',
      resourceId: branchId,
      details: `Created branch ${branchCode} (${data.branchName})`,
    });
    return branchId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateBranch(
  branchId: string,
  organizationId: string,
  updates: Partial<Omit<Branch, 'branchId' | 'organizationId' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  const path = `branches/${branchId}`;
  try {
    await updateDoc(doc(db, 'branches', branchId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      organizationId,
      branchId,
      action: 'branch.update',
      resourceType: 'branch',
      resourceId: branchId,
      details: `Updated branch fields: ${Object.keys(updates).join(', ')}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
