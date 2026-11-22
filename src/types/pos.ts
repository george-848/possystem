export type AccountStatus = 'active' | 'suspended' | 'invited';
export type RecordStatus = 'active' | 'suspended';
export type ProductStatus = 'active' | 'archived';
export type TaxCategory = 'standard' | 'exempt' | 'zero';
export type PaymentMethod = 'cash' | 'mobile_money' | 'card' | 'bank_transfer' | 'split';
export type SinglePaymentMethod = 'cash' | 'mobile_money' | 'card' | 'bank_transfer';
export type SaleStatus = 'completed' | 'cancelled' | 'refunded' | 'partially_refunded';
export type PurchaseStatus = 'draft' | 'pending_approval' | 'approved' | 'received' | 'rejected';
export type TransferStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'dispatched'
  | 'partially_received'
  | 'received'
  | 'rejected'
  | 'cancelled';
export type RefundStatus = 'pending' | 'approved' | 'processed' | 'rejected';
export type CashSessionStatus = 'open' | 'closed' | 'approved';
export type ExpenseApprovalStatus = 'pending' | 'approved' | 'rejected';
export type StockMovementType =
  | 'sale'
  | 'purchase_receipt'
  | 'adjustment_add'
  | 'adjustment_reduce'
  | 'stock_count'
  | 'damaged'
  | 'expired'
  | 'transfer_out'
  | 'transfer_in'
  | 'refund_restock'
  | 'refund_damaged';

export interface Organization {
  organizationId: string;
  businessName: string;
  registrationNumber?: string;
  logoUrl?: string;
  email?: string;
  phone?: string;
  address?: string;
  country?: string;
  currency: string;
  currencySymbol: string;
  timezone: string;
  defaultTaxRateBps: number;
  taxLabel?: string;
  allowNegativeInventory: boolean;
  status: RecordStatus;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Branch {
  branchId: string;
  organizationId: string;
  branchCode: string;
  branchName: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  contactNumber?: string;
  email?: string;
  managerName?: string;
  operatingHours?: string;
  status: RecordStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserProfile {
  uid: string;
  fullName: string;
  email: string;
  phone?: string;
  organizationId: string;
  branchIds: string[];
  defaultBranchId: string;
  roleId: string;
  grantedPermissions: string[];
  deniedPermissions: string[];
  accountStatus: AccountStatus;
  invitationId?: string;
  lastLogin?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Role {
  roleId: string;
  organizationId: string;
  name: string;
  description?: string;
  scope: 'organization' | 'branch';
  permissions: string[];
  isSystem: boolean;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PermissionDefinition {
  permissionId: string;
  organizationId: string;
  module: string;
  action: string;
  label: string;
  description?: string;
}

export interface Invitation {
  invitationId: string;
  organizationId: string;
  email: string;
  fullName: string;
  phone?: string;
  roleId: string;
  branchIds: string[];
  defaultBranchId: string;
  status: 'pending' | 'accepted' | 'revoked';
  invitedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Category {
  categoryId: string;
  organizationId: string;
  name: string;
  description?: string;
  status: ProductStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Product {
  productId: string;
  organizationId: string;
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
  taxCategory: TaxCategory;
  minimumStock: number;
  availableBranchIds?: string[];
  status: ProductStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BranchInventory {
  inventoryId: string;
  organizationId: string;
  branchId: string;
  productId: string;
  quantityAvailable: number;
  reorderLevel: number;
  costPriceMinor: number;
  sellingPriceMinor: number;
  updatedAt?: unknown;
}

export interface StockMovement {
  movementId: string;
  organizationId: string;
  branchId: string;
  productId: string;
  movementType: StockMovementType;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  performedBy: string;
  createdAt?: unknown;
}

export interface Sale {
  saleId: string;
  transactionNumber: string;
  idempotencyKey: string;
  organizationId: string;
  branchId: string;
  cashierId: string;
  cashierName?: string;
  cashSessionId?: string;
  customerId?: string;
  customerName?: string;
  itemCount: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  cogsMinor: number;
  amountTenderedMinor?: number;
  changeMinor?: number;
  paymentMethod: PaymentMethod;
  paymentStatus: 'paid' | 'partial' | 'refunded';
  saleStatus: SaleStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SaleItem {
  itemId: string;
  saleId: string;
  organizationId: string;
  branchId: string;
  productId: string;
  productName: string;
  sku?: string;
  quantity: number;
  returnedQuantity: number;
  unitPriceMinor: number;
  costPriceMinor: number;
  discountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
}

export interface Payment {
  paymentId: string;
  organizationId: string;
  branchId: string;
  saleId: string;
  method: SinglePaymentMethod;
  amountMinor: number;
  reference?: string;
  status: 'settled' | 'manual_unintegrated' | 'refunded';
  createdAt?: unknown;
}

export interface Customer {
  customerId: string;
  organizationId: string;
  branchId: string;
  fullName: string;
  phone?: string;
  email?: string;
  address?: string;
  totalPurchasesMinor: number;
  transactionCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Supplier {
  supplierId: string;
  organizationId: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
  status: 'active' | 'inactive';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Purchase {
  purchaseId: string;
  purchaseNumber: string;
  organizationId: string;
  branchId: string;
  supplierId: string;
  supplierName?: string;
  invoiceNumber?: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  status: PurchaseStatus;
  createdBy: string;
  approvedBy?: string;
  receivedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PurchaseItem {
  itemId: string;
  purchaseId: string;
  organizationId: string;
  branchId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCostMinor: number;
  discountMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
}

export interface StockTransfer {
  transferId: string;
  transferNumber: string;
  organizationId: string;
  sourceBranchId: string;
  destinationBranchId: string;
  status: TransferStatus;
  notes?: string;
  requestedBy: string;
  approvedBy?: string;
  dispatchedBy?: string;
  receivedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TransferItem {
  itemId: string;
  transferId: string;
  organizationId: string;
  productId: string;
  productName: string;
  requestedQuantity: number;
  receivedQuantity: number;
  damagedQuantity: number;
}

export interface Refund {
  refundId: string;
  refundNumber: string;
  organizationId: string;
  branchId: string;
  saleId: string;
  transactionNumber?: string;
  reason: string;
  refundTotalMinor: number;
  refundMethod: SinglePaymentMethod;
  status: RefundStatus;
  requestedBy: string;
  approvedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RefundItem {
  itemId: string;
  refundId: string;
  organizationId: string;
  branchId: string;
  saleItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  condition: 'restock' | 'damaged';
  refundAmountMinor: number;
}

export interface CashSession {
  sessionId: string;
  organizationId: string;
  branchId: string;
  cashierId: string;
  cashierName?: string;
  openingBalanceMinor: number;
  cashSalesMinor: number;
  cashRefundsMinor: number;
  cashDepositsMinor: number;
  cashWithdrawalsMinor: number;
  expectedClosingBalanceMinor: number;
  actualClosingBalanceMinor?: number;
  differenceMinor?: number;
  status: CashSessionStatus;
  approvedBy?: string;
  openedAt?: unknown;
  closedAt?: unknown;
  updatedAt?: unknown;
}

export interface CashSessionTransaction {
  transactionId: string;
  sessionId: string;
  organizationId: string;
  branchId: string;
  type: 'sale' | 'refund' | 'deposit' | 'withdrawal';
  amountMinor: number;
  notes?: string;
  referenceId?: string;
  performedBy: string;
  createdAt?: unknown;
}

export interface Expense {
  expenseId: string;
  organizationId: string;
  branchId: string;
  category: string;
  description: string;
  amountMinor: number;
  expenseDate: string;
  attachmentNote?: string;
  submittedBy: string;
  approvalStatus: ExpenseApprovalStatus;
  approvedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuditLog {
  logId: string;
  userId: string;
  userEmail?: string;
  organizationId: string;
  branchId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId?: string;
  details?: string;
  createdAt?: unknown;
}

export interface BranchDailySummary {
  summaryId: string;
  organizationId: string;
  branchId: string;
  dateKey: string;
  salesCount: number;
  revenueMinor: number;
  cogsMinor: number;
  discountsMinor: number;
  refundsMinor: number;
  expensesMinor: number;
  updatedAt?: unknown;
}

export type ReceiptFieldKey =
  | 'logo'
  | 'branchInfo'
  | 'receiptHeader'
  | 'date'
  | 'cashier'
  | 'customer'
  | 'itemSku'
  | 'itemBreakdown'
  | 'discount'
  | 'tax'
  | 'paymentMethod'
  | 'returnPolicy'
  | 'receiptFooter';

export interface SystemSettings {
  settingId: string;
  organizationId: string;
  receiptHeader: string;
  receiptFooter: string;
  returnPolicy?: string;
  receiptVisibleFields?: ReceiptFieldKey[];
  supportedPaymentMethods: SinglePaymentMethod[];
  maxCashierDiscountPct: number;
  expenseApprovalLimitMinor: number;
  refundWindowDays: number;
  lowStockNotificationsEnabled: boolean;
  updatedAt?: unknown;
}

export interface AppNotification {
  notificationId: string;
  organizationId: string;
  branchId?: string;
  type:
    | 'low_stock'
    | 'pending_approval'
    | 'stock_transfer'
    | 'purchase_completed'
    | 'refund_request'
    | 'cash_discrepancy'
    | 'invitation'
    | 'system_alert';
  title: string;
  message: string;
  readBy: string[];
  createdAt?: unknown;
}
