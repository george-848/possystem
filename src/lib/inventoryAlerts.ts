import { isProductAvailableAtBranch } from './barcode';
import type { Branch, BranchInventory, Product } from '../types/pos';

export type LowStockSeverity = 'out_of_stock' | 'critical' | 'at_threshold';

export interface BranchLowStockAlert {
  key: string;
  organizationId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  quantityAvailable: number;
  minimumThreshold: number;
  deficit: number;
  severity: LowStockSeverity;
  hasInventoryRecord: boolean;
}

export interface BranchAlertSummary {
  branchId: string;
  branchCode: string;
  branchName: string;
  totalCount: number;
  outOfStockCount: number;
  criticalCount: number;
  atThresholdCount: number;
  alerts: BranchLowStockAlert[];
}

const SEVERITY_ORDER: Record<LowStockSeverity, number> = {
  out_of_stock: 0,
  critical: 1,
  at_threshold: 2,
};

export function computeBranchLowStockAlerts(params: {
  products: Product[];
  branchInventory: BranchInventory[];
  branches: Branch[];
}): BranchLowStockAlert[] {
  const { products, branchInventory, branches } = params;
  const activeBranches = branches.filter((b) => b.status === 'active');
  if (activeBranches.length === 0 || products.length === 0) return [];

  const invByComposite = new Map<string, BranchInventory>();
  for (const inv of branchInventory) {
    invByComposite.set(`${inv.branchId}__${inv.productId}`, inv);
  }

  const alerts: BranchLowStockAlert[] = [];

  for (const branch of activeBranches) {
    for (const product of products) {
      if (!isProductAvailableAtBranch(product, branch.branchId)) continue;

      const inv = invByComposite.get(`${branch.branchId}__${product.productId}`);
      const quantityAvailable = inv ? Number(inv.quantityAvailable ?? 0) : 0;
      const minimumThreshold = Math.max(
        0,
        Number(inv ? inv.reorderLevel : product.minimumStock ?? 0)
      );

      const isBelowMinimum = quantityAvailable < minimumThreshold;
      const isAtNonZeroThreshold =
        minimumThreshold > 0 && quantityAvailable <= minimumThreshold;
      const isTrackedEmpty = inv !== undefined && quantityAvailable <= 0;

      if (!isBelowMinimum && !isAtNonZeroThreshold && !isTrackedEmpty) {
        continue;
      }

      const severity: LowStockSeverity =
        quantityAvailable <= 0
          ? 'out_of_stock'
          : quantityAvailable < minimumThreshold
            ? 'critical'
            : 'at_threshold';

      alerts.push({
        key: `${branch.branchId}_${product.productId}`,
        organizationId: product.organizationId,
        branchId: branch.branchId,
        branchCode: branch.branchCode,
        branchName: branch.branchName,
        productId: product.productId,
        productName: product.name,
        sku: product.sku,
        unit: product.unit || 'pcs',
        quantityAvailable,
        minimumThreshold,
        deficit: Math.max(0, minimumThreshold - quantityAvailable),
        severity,
        hasInventoryRecord: Boolean(inv),
      });
    }
  }

  alerts.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    if (b.deficit !== a.deficit) return b.deficit - a.deficit;
    const branchCmp = a.branchName.localeCompare(b.branchName);
    if (branchCmp !== 0) return branchCmp;
    return a.productName.localeCompare(b.productName);
  });

  return alerts;
}

export function summarizeAlertsByBranch(
  alerts: BranchLowStockAlert[],
  branches: Branch[]
): BranchAlertSummary[] {
  const byBranch = new Map<string, BranchAlertSummary>();

  for (const b of branches) {
    if (b.status !== 'active') continue;
    byBranch.set(b.branchId, {
      branchId: b.branchId,
      branchCode: b.branchCode,
      branchName: b.branchName,
      totalCount: 0,
      outOfStockCount: 0,
      criticalCount: 0,
      atThresholdCount: 0,
      alerts: [],
    });
  }

  for (const alert of alerts) {
    let group = byBranch.get(alert.branchId);
    if (!group) {
      group = {
        branchId: alert.branchId,
        branchCode: alert.branchCode,
        branchName: alert.branchName,
        totalCount: 0,
        outOfStockCount: 0,
        criticalCount: 0,
        atThresholdCount: 0,
        alerts: [],
      };
      byBranch.set(alert.branchId, group);
    }
    group.alerts.push(alert);
    group.totalCount += 1;
    if (alert.severity === 'out_of_stock') group.outOfStockCount += 1;
    else if (alert.severity === 'critical') group.criticalCount += 1;
    else group.atThresholdCount += 1;
  }

  return Array.from(byBranch.values())
    .filter((g) => g.totalCount > 0)
    .sort((a, b) => b.totalCount - a.totalCount || a.branchName.localeCompare(b.branchName));
}
