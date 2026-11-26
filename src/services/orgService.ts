import {
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { sanitizeImageSrc } from '../lib/url';
import type { Branch, Organization, SystemSettings } from '../types/pos';
import { cleanOptional, makeId, recordAuditLog } from './auditService';
import { enforceServerEntitlement, registerTenantBusiness } from './saasService';

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
  return registerTenantBusiness(input);
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
  const sanitizedUpdates: Record<string, unknown> = { ...updates };
  if (updates.logoUrl !== undefined) {
    const trimmed = updates.logoUrl.trim();
    if (!trimmed) {
      sanitizedUpdates.logoUrl = deleteField();
    } else {
      const safeSrc = sanitizeImageSrc(trimmed);
      if (!safeSrc) {
        throw new Error(
          'Logo must be a valid http:// or https:// image URL, or an uploaded PNG/JPEG/WebP image under 64KB.'
        );
      }
      sanitizedUpdates.logoUrl = safeSrc;
    }
  }

  try {
    await updateDoc(doc(db, 'organizations', organizationId), {
      ...cleanOptional(sanitizedUpdates),
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      organizationId,
      action: 'organization.update',
      resourceType: 'organization',
      resourceId: organizationId,
      details: `Updated organization configuration: ${Object.keys(sanitizedUpdates).join(', ')}`,
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
  await enforceServerEntitlement({
    organizationId,
    ...(existingBranchesCount >= 1 ? { featureKey: 'multi_branch' as const } : {}),
    quotaResource: 'branches',
    increment: 1,
  });

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
      ...cleanOptional(updates),
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
