import {
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { Category, Product, StockMovementType } from '../types/pos';
import { cleanOptional, createNotification, makeId, recordAuditLog } from './auditService';
import { enforceServerEntitlement } from './saasService';

export async function createCategory(
  organizationId: string,
  data: { name: string; description?: string }
): Promise<string> {
  const categoryId = makeId('cat');
  const path = `categories/${categoryId}`;
  try {
    await setDoc(
      doc(db, 'categories', categoryId),
      cleanOptional({
        categoryId,
        organizationId,
        name: data.name.trim(),
        description: data.description?.trim(),
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await recordAuditLog({
      organizationId,
      action: 'category.create',
      resourceType: 'category',
      resourceId: categoryId,
      details: `Created product category "${data.name}"`,
    });
    return categoryId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateCategory(
  categoryId: string,
  organizationId: string,
  updates: Partial<Pick<Category, 'name' | 'description' | 'status'>>
): Promise<void> {
  const path = `categories/${categoryId}`;
  try {
    const payload = cleanOptional({
      name: updates.name !== undefined ? updates.name.trim() : undefined,
      description:
        updates.description !== undefined ? updates.description.trim() : undefined,
      status: updates.status,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'categories', categoryId), payload);
    await recordAuditLog({
      organizationId,
      action: 'category.update',
      resourceType: 'category',
      resourceId: categoryId,
      details: `Updated category ${categoryId}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export interface ProductInput {
  categoryId?: string;
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  brand?: string;
  unit?: string;
  imageUrl?: string;
  costPriceMinor: number;
  sellingPriceMinor: number;
  wholesalePriceMinor?: number;
  taxCategory: 'standard' | 'exempt' | 'zero';
  minimumStock: number;
  availableBranchIds?: string[];
  initialBranchId?: string;
  initialQuantity?: number;
}

export async function createProduct(
  organizationId: string,
  input: ProductInput
): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  if (input.availableBranchIds && input.availableBranchIds.length === 0) {
    throw new Error('Select at least one branch where this product is available.');
  }
  await enforceServerEntitlement({
    organizationId,
    quotaResource: 'products',
    increment: 1,
  });
  const productId = makeId('prd');
  const path = `products/${productId}`;

  try {
    await setDoc(
      doc(db, 'products', productId),
      cleanOptional({
        productId,
        organizationId,
        categoryId: input.categoryId,
        name: input.name.trim(),
        sku: input.sku.trim().toUpperCase(),
        barcode: input.barcode?.trim(),
        description: input.description?.trim(),
        brand: input.brand?.trim(),
        unit: input.unit?.trim() || 'pcs',
        imageUrl: input.imageUrl?.trim(),
        costPriceMinor: Math.max(0, Math.round(input.costPriceMinor)),
        sellingPriceMinor: Math.max(0, Math.round(input.sellingPriceMinor)),
        wholesalePriceMinor:
          input.wholesalePriceMinor !== undefined
            ? Math.max(0, Math.round(input.wholesalePriceMinor))
            : undefined,
        taxCategory: input.taxCategory,
        minimumStock: Math.max(0, Math.round(input.minimumStock)),
        availableBranchIds: input.availableBranchIds,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const canInitAtBranch =
      Boolean(input.initialBranchId) &&
      (!input.availableBranchIds ||
        input.availableBranchIds.includes(input.initialBranchId as string));

    if (canInitAtBranch && input.initialBranchId && (input.initialQuantity ?? 0) >= 0) {
      await adjustBranchInventory({
        organizationId,
        branchId: input.initialBranchId,
        productId,
        productName: input.name.trim(),
        movementType: 'adjustment_add',
        quantityDelta: Math.max(0, Math.round(input.initialQuantity || 0)),
        reorderLevel: Math.max(0, Math.round(input.minimumStock)),
        costPriceMinor: Math.max(0, Math.round(input.costPriceMinor)),
        sellingPriceMinor: Math.max(0, Math.round(input.sellingPriceMinor)),
        reason: 'Initial opening stock upon product creation',
      });
    }

    await recordAuditLog({
      organizationId,
      branchId: input.initialBranchId,
      action: 'product.create',
      resourceType: 'product',
      resourceId: productId,
      details: `Created product ${input.name} (SKU: ${input.sku})`,
    });

    return productId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateProduct(
  productId: string,
  organizationId: string,
  updates: Partial<
    Pick<
      Product,
      | 'categoryId'
      | 'name'
      | 'sku'
      | 'barcode'
      | 'description'
      | 'brand'
      | 'unit'
      | 'imageUrl'
      | 'costPriceMinor'
      | 'sellingPriceMinor'
      | 'wholesalePriceMinor'
      | 'taxCategory'
      | 'minimumStock'
      | 'availableBranchIds'
      | 'status'
    >
  >,
  priceChanged = false
): Promise<void> {
  const path = `products/${productId}`;
  try {
    await updateDoc(doc(db, 'products', productId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      organizationId,
      action: priceChanged ? 'product.price_change' : 'product.update',
      resourceType: 'product',
      resourceId: productId,
      details: `Updated product ${productId}: ${Object.keys(updates).join(', ')}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adjustBranchInventory(params: {
  organizationId: string;
  branchId: string;
  productId: string;
  productName: string;
  movementType: StockMovementType;
  quantityDelta: number;
  setExactQuantity?: number;
  reorderLevel?: number;
  costPriceMinor?: number;
  sellingPriceMinor?: number;
  reason?: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');

  const inventoryId = `${params.branchId}_${params.productId}`;
  const movementId = makeId('mov');
  const path = `branchInventory/${inventoryId}`;

  try {
    let finalNewQty = 0;
    let finalReorder = params.reorderLevel ?? 5;
    let prevQty = 0;

    await runTransaction(db, async (tx) => {
      const orgRef = doc(db, 'organizations', params.organizationId);
      const invRef = doc(db, 'branchInventory', inventoryId);
      const prodRef = doc(db, 'products', params.productId);
      const movRef = doc(db, 'stockMovements', movementId);

      const [orgSnap, invSnap, prodSnap] = await Promise.all([
        tx.get(orgRef),
        tx.get(invRef),
        tx.get(prodRef),
      ]);

      if (!orgSnap.exists()) throw new Error('Organization not found.');
      const allowNegative = Boolean(orgSnap.data().allowNegativeInventory);
      const prodData = prodSnap.exists() ? (prodSnap.data() as Product) : null;

      prevQty = invSnap.exists() ? Number(invSnap.data().quantityAvailable || 0) : 0;
      const newQty =
        params.setExactQuantity !== undefined
          ? Math.round(params.setExactQuantity)
          : prevQty + Math.round(params.quantityDelta);

      if (!allowNegative && newQty < 0) {
        throw new Error(
          `Negative stock prevented for "${params.productName}". Available: ${prevQty}, attempted new balance: ${newQty}.`
        );
      }

      finalNewQty = newQty;
      finalReorder =
        params.reorderLevel ??
        (invSnap.exists() ? Number(invSnap.data().reorderLevel) : prodData?.minimumStock ?? 5);

      const costPriceMinor =
        params.costPriceMinor ??
        (invSnap.exists() ? Number(invSnap.data().costPriceMinor) : prodData?.costPriceMinor ?? 0);
      const sellingPriceMinor =
        params.sellingPriceMinor ??
        (invSnap.exists()
          ? Number(invSnap.data().sellingPriceMinor)
          : prodData?.sellingPriceMinor ?? 0);

      if (invSnap.exists()) {
        tx.update(invRef, {
          quantityAvailable: newQty,
          reorderLevel: finalReorder,
          costPriceMinor,
          sellingPriceMinor,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(invRef, {
          inventoryId,
          organizationId: params.organizationId,
          branchId: params.branchId,
          productId: params.productId,
          quantityAvailable: newQty,
          reorderLevel: finalReorder,
          costPriceMinor,
          sellingPriceMinor,
          updatedAt: serverTimestamp(),
        });
      }

      const deltaQty = newQty - prevQty;
      tx.set(
        movRef,
        cleanOptional({
          movementId,
          organizationId: params.organizationId,
          branchId: params.branchId,
          productId: params.productId,
          movementType: params.movementType,
          quantity: deltaQty,
          previousQuantity: prevQty,
          newQuantity: newQty,
          referenceType: 'manual_adjustment',
          referenceId: inventoryId,
          reason: params.reason?.trim() || 'Inventory adjustment',
          performedBy: currentUser.uid,
          createdAt: serverTimestamp(),
        })
      );
    });

    if (finalNewQty <= finalReorder) {
      await createNotification({
        organizationId: params.organizationId,
        branchId: params.branchId,
        type: 'low_stock',
        title: `Low Stock Alert: ${params.productName}`,
        message: `Stock is at ${finalNewQty} units (reorder threshold: ${finalReorder}).`,
      });
    }

    await recordAuditLog({
      organizationId: params.organizationId,
      branchId: params.branchId,
      action: `inventory.${params.movementType}`,
      resourceType: 'branchInventory',
      resourceId: inventoryId,
      details: `${params.productName}: ${prevQty} -> ${finalNewQty} (${params.reason || params.movementType})`,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Negative stock prevented')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export interface BulkImportRowInput {
  rowNumber: number;
  action: 'create' | 'update';
  existingProductId?: string;
  categoryId?: string;
  categoryName?: string;
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  brand?: string;
  unit?: string;
  imageUrl?: string;
  costPriceMinor: number;
  sellingPriceMinor: number;
  wholesalePriceMinor?: number;
  taxCategory: 'standard' | 'exempt' | 'zero';
  minimumStock: number;
  initialStock: number;
  status: 'active' | 'archived';
}

export interface BulkProductImportResult {
  createdCount: number;
  updatedCount: number;
  categoriesCreatedCount: number;
  stockInitializedCount: number;
  failedRows: Array<{ rowNumber: number; sku: string; name: string; error: string }>;
}

export async function importProductsBatch(params: {
  organizationId: string;
  rows: BulkImportRowInput[];
  availableBranchIds: string[];
  initialBranchId?: string;
  allowOpeningStock: boolean;
  createMissingCategories: boolean;
  fileName: string;
  onProgress?: (completed: number, total: number) => void;
}): Promise<BulkProductImportResult> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  if (params.availableBranchIds.length === 0) {
    throw new Error('Select at least one branch for imported products.');
  }

  const result: BulkProductImportResult = {
    createdCount: 0,
    updatedCount: 0,
    categoriesCreatedCount: 0,
    stockInitializedCount: 0,
    failedRows: [],
  };

  const createdCategoryIds = new Map<string, string>();
  const total = params.rows.length;

  for (let idx = 0; idx < total; idx++) {
    const row = params.rows[idx];
    try {
      let resolvedCategoryId = row.categoryId;
      if (!resolvedCategoryId && row.categoryName && params.createMissingCategories) {
        const catKey = row.categoryName.trim().toLowerCase();
        const existingNewId = createdCategoryIds.get(catKey);
        if (existingNewId) {
          resolvedCategoryId = existingNewId;
        } else {
          const newCatId = makeId('cat');
          const catPath = `categories/${newCatId}`;
          try {
            await setDoc(
              doc(db, 'categories', newCatId),
              cleanOptional({
                categoryId: newCatId,
                organizationId: params.organizationId,
                name: row.categoryName.trim().slice(0, 100),
                status: 'active',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              })
            );
            createdCategoryIds.set(catKey, newCatId);
            resolvedCategoryId = newCatId;
            result.categoriesCreatedCount += 1;
          } catch (catError) {
            handleFirestoreError(catError, OperationType.CREATE, catPath);
          }
        }
      }

      if (row.action === 'update' && row.existingProductId) {
        const productPath = `products/${row.existingProductId}`;
        try {
          await updateDoc(
            doc(db, 'products', row.existingProductId),
            cleanOptional({
              categoryId: resolvedCategoryId,
              name: row.name.trim(),
              sku: row.sku.trim().toUpperCase(),
              barcode: row.barcode?.trim(),
              description: row.description?.trim(),
              brand: row.brand?.trim(),
              unit: row.unit?.trim() || 'pcs',
              imageUrl: row.imageUrl?.trim(),
              costPriceMinor: Math.max(0, Math.round(row.costPriceMinor)),
              sellingPriceMinor: Math.max(0, Math.round(row.sellingPriceMinor)),
              wholesalePriceMinor:
                row.wholesalePriceMinor !== undefined
                  ? Math.max(0, Math.round(row.wholesalePriceMinor))
                  : undefined,
              taxCategory: row.taxCategory,
              minimumStock: Math.max(0, Math.round(row.minimumStock)),
              availableBranchIds: params.availableBranchIds,
              status: row.status,
              updatedAt: serverTimestamp(),
            })
          );
          result.updatedCount += 1;
        } catch (updateErr) {
          handleFirestoreError(updateErr, OperationType.UPDATE, productPath);
        }
      } else {
        const productId = makeId('prd');
        const productPath = `products/${productId}`;
        try {
          await setDoc(
            doc(db, 'products', productId),
            cleanOptional({
              productId,
              organizationId: params.organizationId,
              categoryId: resolvedCategoryId,
              name: row.name.trim(),
              sku: row.sku.trim().toUpperCase(),
              barcode: row.barcode?.trim(),
              description: row.description?.trim(),
              brand: row.brand?.trim(),
              unit: row.unit?.trim() || 'pcs',
              imageUrl: row.imageUrl?.trim(),
              costPriceMinor: Math.max(0, Math.round(row.costPriceMinor)),
              sellingPriceMinor: Math.max(0, Math.round(row.sellingPriceMinor)),
              wholesalePriceMinor:
                row.wholesalePriceMinor !== undefined
                  ? Math.max(0, Math.round(row.wholesalePriceMinor))
                  : undefined,
              taxCategory: row.taxCategory,
              minimumStock: Math.max(0, Math.round(row.minimumStock)),
              availableBranchIds: params.availableBranchIds,
              status: row.status,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          );
          result.createdCount += 1;
        } catch (createErr) {
          handleFirestoreError(createErr, OperationType.CREATE, productPath);
        }

        if (
          params.allowOpeningStock &&
          params.initialBranchId &&
          params.availableBranchIds.includes(params.initialBranchId) &&
          row.initialStock > 0
        ) {
          await adjustBranchInventory({
            organizationId: params.organizationId,
            branchId: params.initialBranchId,
            productId,
            productName: row.name.trim(),
            movementType: 'adjustment_add',
            quantityDelta: Math.max(0, Math.round(row.initialStock)),
            reorderLevel: Math.max(0, Math.round(row.minimumStock)),
            costPriceMinor: Math.max(0, Math.round(row.costPriceMinor)),
            sellingPriceMinor: Math.max(0, Math.round(row.sellingPriceMinor)),
            reason: `Imported opening stock from ${params.fileName}`,
          });
          result.stockInitializedCount += 1;
        }
      }
    } catch (err) {
      result.failedRows.push({
        rowNumber: row.rowNumber,
        sku: row.sku,
        name: row.name,
        error: err instanceof Error ? err.message : 'Unable to save product.',
      });
    }
    params.onProgress?.(idx + 1, total);
  }

  await recordAuditLog({
    organizationId: params.organizationId,
    branchId: params.initialBranchId,
    action: 'product.bulk_import',
    resourceType: 'product',
    resourceId: params.organizationId,
    details: `Imported ${params.fileName}: ${result.createdCount} created, ${result.updatedCount} updated, ${result.categoriesCreatedCount} categories added, ${result.failedRows.length} failed`,
  });

  return result;
}
