import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  calculateLineAmounts,
  calculateOrderTotals,
  formatDateTime,
  formatMoney,
  formatTaxDisplayValue,
  getDateKey,
} from '../lib/money';
import { resolveReceiptFields } from '../lib/receiptConfig';
import type {
  Branch,
  Organization,
  PaymentMethod,
  Product,
  RefundItem,
  Sale,
  SaleItem,
  SinglePaymentMethod,
  SystemSettings,
  TaxCategory,
} from '../types/pos';
import { apiRequest, cleanOptional, createNotification, makeId, recordAuditLog } from './auditService';

export interface PosCartItemInput {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  discountMinor: number;
  taxCategory: TaxCategory;
}

export interface PosPaymentSplit {
  method: SinglePaymentMethod;
  amountMinor: number;
  reference?: string;
}

export interface CreateSaleInput {
  organizationId: string;
  branchId: string;
  settingId?: string;
  cashierName: string;
  cashSessionId?: string;
  customerId?: string;
  customerName?: string;
  orderDiscountMinor: number;
  items: PosCartItemInput[];
  payments: PosPaymentSplit[];
  idempotencyKey: string;
}

export interface CreateSaleResult {
  saleId: string;
  transactionNumber: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountTenderedMinor: number;
  changeMinor: number;
  items: SaleItem[];
}

export async function processPosSale(input: CreateSaleInput): Promise<CreateSaleResult> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('You must be signed in to process sales.');
  if (input.items.length === 0) throw new Error('Cart is empty.');

  const saleId = makeId('sale');
  const dateKey = getDateKey();
  const summaryId = `${input.branchId}_${dateKey}`;

  // Fetch canonical prices first to verify calculations with Express backend
  const salePath = `sales/${saleId}`;

  let resolvedTaxRateBps = 0;
  let resolvedTaxIncludedInPrice = false;
  let lowStockNotificationsEnabled = true;
  const lowStockAlertsTriggered: Array<{ productName: string; newQty: number; threshold: number }> = [];

  try {
    const resultData = await runTransaction(db, async (tx): Promise<CreateSaleResult> => {
      const idempRef = doc(db, 'idempotencyKeys', input.idempotencyKey);
      const orgRef = doc(db, 'organizations', input.organizationId);
      const settingRef = input.settingId ? doc(db, 'systemSettings', input.settingId) : null;
      const invRefs = input.items.map((item) =>
        doc(db, 'branchInventory', `${input.branchId}_${item.productId}`)
      );
      const prodRefs = input.items.map((item) => doc(db, 'products', item.productId));
      const sessionRef = input.cashSessionId
        ? doc(db, 'cashSessions', input.cashSessionId)
        : null;
      const customerRef = input.customerId ? doc(db, 'customers', input.customerId) : null;
      const summaryRef = doc(db, 'branchDailySummaries', summaryId);

      // ALL READS FIRST
      const [idempSnap, orgSnap, settingSnap, sessionSnap, customerSnap, summarySnap, ...restSnaps] =
        await Promise.all([
          tx.get(idempRef),
          tx.get(orgRef),
          settingRef ? tx.get(settingRef) : Promise.resolve(null),
          sessionRef ? tx.get(sessionRef) : Promise.resolve(null),
          customerRef ? tx.get(customerRef) : Promise.resolve(null),
          tx.get(summaryRef),
          ...invRefs.map((r) => tx.get(r)),
          ...prodRefs.map((r) => tx.get(r)),
        ]);

      if (idempSnap.exists()) {
        throw new Error('Duplicate transaction blocked by idempotency check.');
      }
      if (!orgSnap.exists()) {
        throw new Error('Organization record not found.');
      }
      const org = orgSnap.data() as Organization;
      const allowNegative = Boolean(org.allowNegativeInventory);
      const defaultTaxRateBps = Number(org.defaultTaxRateBps || 0);
      const settingData =
        settingSnap &&
        settingSnap.exists() &&
        settingSnap.data().organizationId === input.organizationId
          ? settingSnap.data()
          : null;
      const taxIncludedInPrice = Boolean(settingData?.taxIncludedInPrice);
      lowStockNotificationsEnabled =
        settingData && settingData.lowStockNotificationsEnabled !== undefined
          ? Boolean(settingData.lowStockNotificationsEnabled)
          : true;
      resolvedTaxRateBps = defaultTaxRateBps;
      resolvedTaxIncludedInPrice = taxIncludedInPrice;

      const invSnaps = restSnaps.slice(0, input.items.length);
      const prodSnaps = restSnaps.slice(input.items.length);

      // Build authoritative line items using DB-stored prices (never trusting frontend prices)
      const calcInputs = input.items.map((item, idx) => {
        const invSnap = invSnaps[idx];
        const prodSnap = prodSnaps[idx];
        if (!prodSnap.exists()) {
          throw new Error(`Product "${item.productName}" no longer exists.`);
        }
        const prod = prodSnap.data() as Product;
        if (prod.status === 'archived') {
          throw new Error(`Product "${prod.name}" is archived and cannot be sold.`);
        }
        if (!invSnap.exists()) {
          throw new Error(
            `No inventory record for "${prod.name}" at this branch. Add stock first.`
          );
        }
        const inv = invSnap.data();
        const available = Number(inv.quantityAvailable || 0);
        if (!allowNegative && available < item.quantity) {
          throw new Error(
            `Insufficient stock for "${prod.name}". Available: ${available}, requested: ${item.quantity}.`
          );
        }

        const unitPriceMinor = Number(inv.sellingPriceMinor ?? prod.sellingPriceMinor);
        const costPriceMinor = Number(inv.costPriceMinor ?? prod.costPriceMinor);
        return {
          item,
          prod,
          inv,
          available,
          unitPriceMinor,
          costPriceMinor,
          taxCategory: prod.taxCategory,
        };
      });

      const orderTotals = calculateOrderTotals(
        calcInputs.map((c) => ({
          unitPriceMinor: c.unitPriceMinor,
          costPriceMinor: c.costPriceMinor,
          quantity: c.item.quantity,
          discountMinor: c.item.discountMinor,
          taxCategory: c.taxCategory,
        })),
        input.orderDiscountMinor,
        defaultTaxRateBps,
        taxIncludedInPrice
      );

      const totalTenderedMinor = input.payments.reduce((s, p) => s + p.amountMinor, 0);
      if (totalTenderedMinor < orderTotals.totalMinor) {
        throw new Error(
          `Payment tendered (${totalTenderedMinor}) is less than grand total (${orderTotals.totalMinor}).`
        );
      }
      const changeMinor = Math.max(0, totalTenderedMinor - orderTotals.totalMinor);

      if (sessionSnap && (!sessionSnap.exists() || sessionSnap.data().status !== 'open')) {
        throw new Error('Selected cash register session is not open.');
      }

      const txnNum = `TXN-${dateKey.replace(/-/g, '')}-${saleId.slice(-6).toUpperCase()}`;
      const paymentMethod: PaymentMethod =
        input.payments.length > 1 ? 'split' : input.payments[0].method;

      // WRITES BEGIN
      tx.set(idempRef, {
        keyId: input.idempotencyKey,
        organizationId: input.organizationId,
        branchId: input.branchId,
        resourceType: 'sale',
        resourceId: saleId,
        createdAt: serverTimestamp(),
      });

      tx.set(
        doc(db, 'sales', saleId),
        cleanOptional({
          saleId,
          transactionNumber: txnNum,
          idempotencyKey: input.idempotencyKey,
          organizationId: input.organizationId,
          branchId: input.branchId,
          cashierId: currentUser.uid,
          cashierName: input.cashierName,
          cashSessionId: input.cashSessionId,
          customerId: input.customerId,
          customerName: input.customerName,
          itemCount: input.items.reduce((s, i) => s + i.quantity, 0),
          subtotalMinor: orderTotals.subtotalMinor,
          discountMinor: orderTotals.discountMinor,
          taxMinor: orderTotals.taxMinor,
          totalMinor: orderTotals.totalMinor,
          cogsMinor: orderTotals.cogsMinor,
          amountTenderedMinor: totalTenderedMinor,
          changeMinor,
          paymentMethod,
          paymentStatus: 'paid',
          saleStatus: 'completed',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      const builtItems: SaleItem[] = [];
      for (let i = 0; i < calcInputs.length; i++) {
        const entry = calcInputs[i];
        const lineCalc = calculateLineAmounts(
          {
            unitPriceMinor: entry.unitPriceMinor,
            costPriceMinor: entry.costPriceMinor,
            quantity: entry.item.quantity,
            discountMinor: entry.item.discountMinor,
            taxCategory: entry.taxCategory,
          },
          defaultTaxRateBps,
          taxIncludedInPrice
        );
        const itemId = makeId('si');
        const saleItem: SaleItem = {
          itemId,
          saleId,
          organizationId: input.organizationId,
          branchId: input.branchId,
          productId: entry.prod.productId,
          productName: entry.prod.name,
          sku: entry.prod.sku,
          quantity: entry.item.quantity,
          returnedQuantity: 0,
          unitPriceMinor: entry.unitPriceMinor,
          costPriceMinor: entry.costPriceMinor,
          discountMinor: lineCalc.discountMinor,
          taxMinor: lineCalc.taxMinor,
          lineTotalMinor: lineCalc.lineTotalMinor,
        };
        builtItems.push(saleItem);

        tx.set(doc(db, 'sales', saleId, 'items', itemId), cleanOptional({ ...saleItem }));

        const newQty = entry.available - entry.item.quantity;
        const reorderThreshold = Math.max(
          0,
          Number(entry.inv.reorderLevel ?? entry.prod.minimumStock ?? 0)
        );
        if (
          lowStockNotificationsEnabled &&
          (newQty < reorderThreshold || (reorderThreshold > 0 && newQty <= reorderThreshold) || newQty <= 0)
        ) {
          lowStockAlertsTriggered.push({
            productName: entry.prod.name,
            newQty,
            threshold: reorderThreshold,
          });
        }
        tx.update(invRefs[i], {
          quantityAvailable: newQty,
          updatedAt: serverTimestamp(),
        });

        const movementId = makeId('mov');
        tx.set(doc(db, 'stockMovements', movementId), {
          movementId,
          organizationId: input.organizationId,
          branchId: input.branchId,
          productId: entry.prod.productId,
          movementType: 'sale',
          quantity: -entry.item.quantity,
          previousQuantity: entry.available,
          newQuantity: newQty,
          referenceType: 'sale',
          referenceId: saleId,
          reason: `POS Sale ${txnNum}`,
          performedBy: currentUser.uid,
          createdAt: serverTimestamp(),
        });
      }

      // Payments breakdown (net cash after change for cash component)
      let remainingChange = changeMinor;
      let cashReceivedNetMinor = 0;
      for (const p of input.payments) {
        const paymentId = makeId('pay');
        let netAmount = p.amountMinor;
        if (p.method === 'cash' && remainingChange > 0) {
          const deduction = Math.min(netAmount, remainingChange);
          netAmount -= deduction;
          remainingChange -= deduction;
        }
        if (p.method === 'cash') {
          cashReceivedNetMinor += netAmount;
        }
        tx.set(
          doc(db, 'payments', paymentId),
          cleanOptional({
            paymentId,
            organizationId: input.organizationId,
            branchId: input.branchId,
            saleId,
            method: p.method,
            amountMinor: netAmount,
            reference: p.reference,
            status: p.method === 'cash' ? 'settled' : 'manual_unintegrated',
            createdAt: serverTimestamp(),
          })
        );
      }

      if (sessionSnap && sessionSnap.exists() && cashReceivedNetMinor > 0 && sessionRef) {
        const sData = sessionSnap.data();
        const nextCashSales = Number(sData.cashSalesMinor || 0) + cashReceivedNetMinor;
        const nextExpected = Number(sData.expectedClosingBalanceMinor || 0) + cashReceivedNetMinor;
        tx.update(sessionRef, {
          cashSalesMinor: nextCashSales,
          expectedClosingBalanceMinor: nextExpected,
          updatedAt: serverTimestamp(),
        });
        const csTxId = makeId('cstx');
        tx.set(doc(db, 'cashSessions', input.cashSessionId!, 'transactions', csTxId), {
          transactionId: csTxId,
          sessionId: input.cashSessionId!,
          organizationId: input.organizationId,
          branchId: input.branchId,
          type: 'sale',
          amountMinor: cashReceivedNetMinor,
          notes: `Cash sale ${txnNum}`,
          referenceId: saleId,
          performedBy: currentUser.uid,
          createdAt: serverTimestamp(),
        });
      }

      if (customerSnap && customerSnap.exists() && customerRef) {
        const cData = customerSnap.data();
        tx.update(customerRef, {
          totalPurchasesMinor: Number(cData.totalPurchasesMinor || 0) + orderTotals.totalMinor,
          transactionCount: Number(cData.transactionCount || 0) + 1,
          updatedAt: serverTimestamp(),
        });
      }

      if (summarySnap.exists()) {
        const prev = summarySnap.data();
        tx.update(summaryRef, {
          salesCount: Number(prev.salesCount || 0) + 1,
          revenueMinor: Number(prev.revenueMinor || 0) + orderTotals.totalMinor,
          cogsMinor: Number(prev.cogsMinor || 0) + orderTotals.cogsMinor,
          discountsMinor: Number(prev.discountsMinor || 0) + orderTotals.discountMinor,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(summaryRef, {
          summaryId,
          organizationId: input.organizationId,
          branchId: input.branchId,
          dateKey,
          salesCount: 1,
          revenueMinor: orderTotals.totalMinor,
          cogsMinor: orderTotals.cogsMinor,
          discountsMinor: orderTotals.discountMinor,
          refundsMinor: 0,
          expensesMinor: 0,
          updatedAt: serverTimestamp(),
        });
      }

      return {
        saleId,
        transactionNumber: txnNum,
        subtotalMinor: orderTotals.subtotalMinor,
        discountMinor: orderTotals.discountMinor,
        taxMinor: orderTotals.taxMinor,
        totalMinor: orderTotals.totalMinor,
        amountTenderedMinor: totalTenderedMinor,
        changeMinor,
        items: builtItems,
      };
    });

    // Best-effort backend verification log + audit log
    void apiRequest('/api/pos/verify-checkout', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: input.organizationId,
        branchId: input.branchId,
        defaultTaxRateBps: resolvedTaxRateBps,
        taxIncludedInPrice: resolvedTaxIncludedInPrice,
        orderDiscountMinor: input.orderDiscountMinor,
        items: resultData.items.map((i, idx) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPriceMinor: i.unitPriceMinor,
          costPriceMinor: i.costPriceMinor,
          discountMinor: i.discountMinor,
          taxCategory: input.items[idx]?.taxCategory || 'standard',
        })),
        payments: input.payments,
      }),
    }).catch(() => {});

    if (lowStockNotificationsEnabled && lowStockAlertsTriggered.length > 0) {
      const preview = lowStockAlertsTriggered
        .slice(0, 3)
        .map((a) => `${a.productName} (${a.newQty}/${a.threshold})`)
        .join(', ');
      await createNotification({
        organizationId: input.organizationId,
        branchId: input.branchId,
        type: 'low_stock',
        title:
          lowStockAlertsTriggered.length === 1
            ? `Low Stock Alert: ${lowStockAlertsTriggered[0].productName}`
            : `Low Stock Alert: ${lowStockAlertsTriggered.length} Products Below Threshold`,
        message: `${preview}${lowStockAlertsTriggered.length > 3 ? ` +${lowStockAlertsTriggered.length - 3} more` : ''} after sale ${resultData.transactionNumber}.`,
      });
    }

    await recordAuditLog({
      organizationId: input.organizationId,
      branchId: input.branchId,
      action: 'sale.create',
      resourceType: 'sale',
      resourceId: saleId,
      details: `Completed POS Sale ${resultData.transactionNumber} totalMinor=${resultData.totalMinor}`,
    });

    return resultData;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Insufficient stock') ||
        error.message.includes('Duplicate transaction') ||
        error.message.includes('No inventory record') ||
        error.message.includes('Payment tendered') ||
        error.message.includes('cash register session'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, salePath);
  }
}

export async function fetchSaleItems(
  saleId: string,
  organizationId: string
): Promise<SaleItem[]> {
  const path = `sales/${saleId}/items`;
  try {
    const snap = await getDocs(
      query(collection(db, 'sales', saleId, 'items'), where('organizationId', '==', organizationId))
    );
    return snap.docs.map((d) => d.data() as SaleItem);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchRefundItems(
  refundId: string,
  organizationId: string
): Promise<RefundItem[]> {
  const path = `refunds/${refundId}/items`;
  try {
    const snap = await getDocs(
      query(collection(db, 'refunds', refundId, 'items'), where('organizationId', '==', organizationId))
    );
    return snap.docs.map((d) => d.data() as RefundItem);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createRefundRequest(params: {
  organizationId: string;
  branchId: string;
  sale: Sale;
  reason: string;
  refundMethod: SinglePaymentMethod;
  items: Array<{
    saleItem: SaleItem;
    returnQuantity: number;
    condition: 'restock' | 'damaged';
  }>;
}): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  if (params.items.length === 0) throw new Error('Select at least one item to return.');

  const refundId = makeId('ref');
  const refundNumber = `REF-${getDateKey().replace(/-/g, '')}-${refundId.slice(-5).toUpperCase()}`;
  const path = `refunds/${refundId}`;

  let refundTotalMinor = 0;
  for (const entry of params.items) {
    const remainingReturnable = entry.saleItem.quantity - (entry.saleItem.returnedQuantity || 0);
    if (entry.returnQuantity <= 0 || entry.returnQuantity > remainingReturnable) {
      throw new Error(
        `Cannot return ${entry.returnQuantity} of "${entry.saleItem.productName}". Remaining returnable: ${remainingReturnable}.`
      );
    }
    const perUnitMinor = Math.round(entry.saleItem.lineTotalMinor / entry.saleItem.quantity);
    refundTotalMinor += perUnitMinor * entry.returnQuantity;
  }

  try {
    await setDoc(doc(db, 'refunds', refundId), {
      refundId,
      refundNumber,
      organizationId: params.organizationId,
      branchId: params.branchId,
      saleId: params.sale.saleId,
      transactionNumber: params.sale.transactionNumber,
      reason: params.reason.trim(),
      refundTotalMinor,
      refundMethod: params.refundMethod,
      status: 'pending',
      requestedBy: currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const entry of params.items) {
      const itemId = makeId('ri');
      const perUnitMinor = Math.round(entry.saleItem.lineTotalMinor / entry.saleItem.quantity);
      await setDoc(doc(db, 'refunds', refundId, 'items', itemId), {
        itemId,
        refundId,
        organizationId: params.organizationId,
        branchId: params.branchId,
        saleItemId: entry.saleItem.itemId,
        productId: entry.saleItem.productId,
        productName: entry.saleItem.productName,
        quantity: entry.returnQuantity,
        condition: entry.condition,
        refundAmountMinor: perUnitMinor * entry.returnQuantity,
      });
    }

    await createNotification({
      organizationId: params.organizationId,
      branchId: params.branchId,
      type: 'refund_request',
      title: `Refund Approval Requested: ${refundNumber}`,
      message: `Refund for sale ${params.sale.transactionNumber} requires supervisor approval.`,
    });

    await recordAuditLog({
      organizationId: params.organizationId,
      branchId: params.branchId,
      action: 'refund.request',
      resourceType: 'refund',
      resourceId: refundId,
      details: `Requested refund ${refundNumber} on sale ${params.sale.transactionNumber}`,
    });

    return refundId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function processRefundDecision(params: {
  refundId: string;
  organizationId: string;
  branchId: string;
  decision: 'approve' | 'reject';
  activeCashSessionId?: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  const path = `refunds/${params.refundId}`;

  const refundItems = await fetchRefundItems(params.refundId, params.organizationId);
  const dateKey = getDateKey();
  const summaryId = `${params.branchId}_${dateKey}`;

  try {
    await runTransaction(db, async (tx) => {
      const refundRef = doc(db, 'refunds', params.refundId);
      const refundSnap = await tx.get(refundRef);
      if (!refundSnap.exists()) throw new Error('Refund request not found.');
      const refundData = refundSnap.data();
      if (refundData.status !== 'pending') {
        throw new Error('This refund has already been processed.');
      }

      if (params.decision === 'reject') {
        tx.update(refundRef, {
          status: 'rejected',
          approvedBy: currentUser.uid,
          updatedAt: serverTimestamp(),
        });
        return;
      }

      const saleRef = doc(db, 'sales', refundData.saleId);
      const saleItemRefs = refundItems.map((ri) =>
        doc(db, 'sales', refundData.saleId, 'items', ri.saleItemId)
      );
      const invRefs = refundItems.map((ri) =>
        doc(db, 'branchInventory', `${params.branchId}_${ri.productId}`)
      );
      const sessionRef =
        refundData.refundMethod === 'cash' && params.activeCashSessionId
          ? doc(db, 'cashSessions', params.activeCashSessionId)
          : null;
      const summaryRef = doc(db, 'branchDailySummaries', summaryId);

      const [saleSnap, sessionSnap, summarySnap, ...otherSnaps] = await Promise.all([
        tx.get(saleRef),
        sessionRef ? tx.get(sessionRef) : Promise.resolve(null),
        tx.get(summaryRef),
        ...saleItemRefs.map((r) => tx.get(r)),
        ...invRefs.map((r) => tx.get(r)),
      ]);

      if (!saleSnap.exists()) throw new Error('Original sale not found.');
      const saleItemSnaps = otherSnaps.slice(0, refundItems.length);
      const invSnaps = otherSnaps.slice(refundItems.length);

      for (let i = 0; i < refundItems.length; i++) {
        const ri = refundItems[i];
        const siSnap = saleItemSnaps[i];
        const invSnap = invSnaps[i];
        if (!siSnap.exists()) throw new Error(`Sale line item missing for ${ri.productName}`);
        const si = siSnap.data() as SaleItem;
        const remaining = si.quantity - (si.returnedQuantity || 0);
        if (ri.quantity > remaining) {
          throw new Error(`Return quantity exceeds remaining returnable quantity for ${ri.productName}.`);
        }

        tx.update(saleItemRefs[i], {
          returnedQuantity: (si.returnedQuantity || 0) + ri.quantity,
        });

        const prevQty = invSnap.exists() ? Number(invSnap.data().quantityAvailable || 0) : 0;
        const newQty = ri.condition === 'restock' ? prevQty + ri.quantity : prevQty;

        if (ri.condition === 'restock' && invSnap.exists()) {
          tx.update(invRefs[i], {
            quantityAvailable: newQty,
            updatedAt: serverTimestamp(),
          });
        }

        const movementId = makeId('mov');
        tx.set(doc(db, 'stockMovements', movementId), {
          movementId,
          organizationId: params.organizationId,
          branchId: params.branchId,
          productId: ri.productId,
          movementType: ri.condition === 'restock' ? 'refund_restock' : 'refund_damaged',
          quantity: ri.condition === 'restock' ? ri.quantity : 0,
          previousQuantity: prevQty,
          newQuantity: newQty,
          referenceType: 'refund',
          referenceId: params.refundId,
          reason: `Refund ${refundData.refundNumber} (${ri.condition})`,
          performedBy: currentUser.uid,
          createdAt: serverTimestamp(),
        });
      }

      const saleTotal = Number(saleSnap.data().totalMinor || 0);
      const isFullRefund = Number(refundData.refundTotalMinor || 0) >= saleTotal;
      tx.update(saleRef, {
        saleStatus: isFullRefund ? 'refunded' : 'partially_refunded',
        paymentStatus: isFullRefund ? 'refunded' : 'paid',
        updatedAt: serverTimestamp(),
      });

      tx.update(refundRef, {
        status: 'processed',
        approvedBy: currentUser.uid,
        updatedAt: serverTimestamp(),
      });

      if (sessionSnap && sessionSnap.exists() && sessionSnap.data().status === 'open' && sessionRef) {
        const sData = sessionSnap.data();
        const refundAmt = Number(refundData.refundTotalMinor || 0);
        tx.update(sessionRef, {
          cashRefundsMinor: Number(sData.cashRefundsMinor || 0) + refundAmt,
          expectedClosingBalanceMinor: Number(sData.expectedClosingBalanceMinor || 0) - refundAmt,
          updatedAt: serverTimestamp(),
        });
      }

      if (summarySnap.exists()) {
        const prev = summarySnap.data();
        tx.update(summaryRef, {
          refundsMinor: Number(prev.refundsMinor || 0) + Number(refundData.refundTotalMinor || 0),
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(summaryRef, {
          summaryId,
          organizationId: params.organizationId,
          branchId: params.branchId,
          dateKey,
          salesCount: 0,
          revenueMinor: 0,
          cogsMinor: 0,
          discountsMinor: 0,
          refundsMinor: Number(refundData.refundTotalMinor || 0),
          expensesMinor: 0,
          updatedAt: serverTimestamp(),
        });
      }
    });

    await recordAuditLog({
      organizationId: params.organizationId,
      branchId: params.branchId,
      action: `refund.${params.decision}`,
      resourceType: 'refund',
      resourceId: params.refundId,
      details: `Refund ${params.refundId} ${params.decision}ed by ${currentUser.uid}`,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Return quantity exceeds')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function downloadReceiptPdf(params: {
  organization: Organization;
  branch?: Branch | null;
  settings?: SystemSettings | null;
  sale: Sale;
  items: SaleItem[];
  paperSize?: 'thermal_80' | 'thermal_58' | 'a4_portrait';
}): void {
  const mode = params.paperSize || 'thermal_80';
  const sym = params.organization.currencySymbol || 'GH₵';
  const rf = resolveReceiptFields(params.settings);
  const taxInclusive = Boolean(params.settings?.taxIncludedInPrice);
  const taxTitle = `${params.organization.taxLabel || 'VAT'}${taxInclusive ? ' Incl.' : ''}`;
  const formattedTaxDisplay = formatTaxDisplayValue({
    taxMinor: params.sale.taxMinor,
    currencySymbol: sym,
    defaultTaxRateBps: params.organization.defaultTaxRateBps,
    taxDisplayMode: params.settings?.taxDisplayMode,
  });
  const logoSrc = params.organization.logoUrl?.trim();
  const isDataLogo =
    typeof logoSrc === 'string' && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(logoSrc);
  const dataLogoFmt =
    logoSrc && /image\/(jpeg|jpg)/i.test(logoSrc)
      ? 'JPEG'
      : logoSrc && /image\/webp/i.test(logoSrc)
        ? 'WEBP'
        : 'PNG';

  if (mode === 'a4_portrait') {
    const docPdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const pageW = docPdf.internal.pageSize.getWidth();
    const margin = 44;
    let y = 48;

    if (rf.logo && isDataLogo && logoSrc) {
      try {
        docPdf.addImage(logoSrc, dataLogoFmt, pageW / 2 - 22, y - 14, 44, 44);
        y += 42;
      } catch {
        // Ignore invalid image dimensions
      }
    }

    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(16);
    docPdf.text(params.organization.businessName, pageW / 2, y, { align: 'center' });
    y += 16;

    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(10);
    if (rf.branchInfo && params.branch) {
      docPdf.text(`${params.branch.branchName} (${params.branch.branchCode})`, pageW / 2, y, {
        align: 'center',
      });
      y += 13;
      if (params.branch.address) {
        docPdf.text(params.branch.address, pageW / 2, y, { align: 'center' });
        y += 13;
      }
      if (params.branch.contactNumber) {
        docPdf.text(`Tel: ${params.branch.contactNumber}`, pageW / 2, y, { align: 'center' });
        y += 13;
      }
    }
    if (rf.receiptHeader && params.settings?.receiptHeader) {
      docPdf.text(params.settings.receiptHeader, pageW / 2, y, { align: 'center' });
      y += 16;
    }

    docPdf.setDrawColor(203, 213, 225);
    docPdf.line(margin, y, pageW - margin, y);
    y += 18;

    docPdf.setFontSize(10);
    docPdf.text(`Receipt No: ${params.sale.transactionNumber}`, margin, y);
    if (rf.cashier) {
      docPdf.text(`Cashier: ${params.sale.cashierName || 'Staff'}`, pageW - margin, y, {
        align: 'right',
      });
    }
    y += 15;
    if (rf.date || rf.customer) {
      if (rf.date) {
        docPdf.text(`Date: ${formatDateTime(params.sale.createdAt)}`, margin, y);
      }
      if (rf.customer) {
        docPdf.text(
          `Customer: ${params.sale.customerName || 'Walk-in Customer'}`,
          rf.date ? pageW - margin : margin,
          y,
          rf.date ? { align: 'right' } : undefined
        );
      }
      y += 15;
    }
    if (rf.paymentMethod) {
      docPdf.text(
        `Payment: ${params.sale.paymentMethod.replace('_', ' ').toUpperCase()}`,
        margin,
        y
      );
      y += 18;
    } else {
      y += 6;
    }

    docPdf.setFillColor(241, 245, 249);
    docPdf.rect(margin, y, pageW - margin * 2, 22, 'F');
    docPdf.setFont('helvetica', 'bold');
    docPdf.text('Item', margin + 8, y + 15);
    if (rf.itemBreakdown) {
      docPdf.text('Qty x Price', pageW - 190, y + 15, { align: 'right' });
    }
    docPdf.text('Total', pageW - margin - 8, y + 15, { align: 'right' });
    y += 28;

    docPdf.setFont('helvetica', 'normal');
    for (const item of params.items) {
      if (y > 750) {
        docPdf.addPage();
        y = 48;
      }
      const itemLabel =
        rf.itemSku && item.sku
          ? `${item.productName} [${item.sku}]`.slice(0, 48)
          : item.productName.slice(0, 48);
      docPdf.text(itemLabel, margin + 8, y);
      if (rf.itemBreakdown) {
        docPdf.text(
          `${item.quantity} x ${formatMoney(item.unitPriceMinor, sym)}`,
          pageW - 190,
          y,
          { align: 'right' }
        );
      }
      docPdf.text(formatMoney(item.lineTotalMinor, sym), pageW - margin - 8, y, {
        align: 'right',
      });
      y += 18;
    }

    y += 6;
    docPdf.line(margin, y, pageW - margin, y);
    y += 18;
    docPdf.text('Subtotal:', pageW - 200, y);
    docPdf.text(formatMoney(params.sale.subtotalMinor, sym), pageW - margin - 8, y, {
      align: 'right',
    });
    y += 15;
    if (rf.discount) {
      docPdf.text('Discount:', pageW - 200, y);
      docPdf.text(`-${formatMoney(params.sale.discountMinor, sym)}`, pageW - margin - 8, y, {
        align: 'right',
      });
      y += 15;
    }
    if (rf.tax) {
      docPdf.text(`Tax (${taxTitle}):`, pageW - 200, y);
      docPdf.text(formattedTaxDisplay, pageW - margin - 8, y, {
        align: 'right',
      });
      y += 18;
    }
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(12);
    docPdf.text('GRAND TOTAL:', pageW - 200, y);
    docPdf.text(formatMoney(params.sale.totalMinor, sym), pageW - margin - 8, y, {
      align: 'right',
    });
    y += 24;

    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(9);
    if (rf.returnPolicy && params.settings?.returnPolicy) {
      const lines = docPdf.splitTextToSize(params.settings.returnPolicy, pageW - margin * 2);
      docPdf.text(lines, pageW / 2, y, { align: 'center' });
      y += lines.length * 12 + 8;
    }
    if (rf.receiptFooter && params.settings?.receiptFooter) {
      docPdf.text(params.settings.receiptFooter, pageW / 2, y, { align: 'center' });
    }
    docPdf.save(`${params.sale.transactionNumber}.pdf`);
    return;
  }

  const widthMm = mode === 'thermal_58' ? 58 : 80;
  const centerX = widthMm / 2;
  const rightX = widthMm - 4;
  const leftX = 4;
  const maxTextWidth = widthMm - 8;
  const estimatedHeight = Math.max(170, 125 + params.items.length * 9);

  const docPdf = new jsPDF({ unit: 'mm', format: [widthMm, estimatedHeight] });
  let y = 9;

  if (rf.logo && isDataLogo && logoSrc) {
    try {
      const logoSize = mode === 'thermal_58' ? 10 : 12;
      docPdf.addImage(logoSrc, dataLogoFmt, centerX - logoSize / 2, 4, logoSize, logoSize);
      y = 4 + logoSize + 4;
    } catch {
      // Ignore invalid image data
    }
  }

  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(mode === 'thermal_58' ? 9.5 : 11);
  docPdf.text(params.organization.businessName, centerX, y, { align: 'center' });
  y += 4.5;

  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(mode === 'thermal_58' ? 7 : 8);
  if (rf.branchInfo && params.branch) {
    docPdf.text(`${params.branch.branchName} (${params.branch.branchCode})`, centerX, y, {
      align: 'center',
    });
    y += 3.8;
    if (params.branch.address) {
      docPdf.text(params.branch.address.slice(0, mode === 'thermal_58' ? 30 : 42), centerX, y, {
        align: 'center',
      });
      y += 3.8;
    }
    if (params.branch.contactNumber) {
      docPdf.text(`Tel: ${params.branch.contactNumber}`, centerX, y, { align: 'center' });
      y += 3.8;
    }
  }
  if (rf.receiptHeader && params.settings?.receiptHeader) {
    docPdf.text(
      params.settings.receiptHeader.slice(0, mode === 'thermal_58' ? 32 : 46),
      centerX,
      y,
      { align: 'center' }
    );
    y += 3.8;
  }

  const divider = mode === 'thermal_58' ? '------------------------------' : '------------------------------------------';
  docPdf.text(divider, centerX, y, { align: 'center' });
  y += 4;
  docPdf.text(`Receipt: ${params.sale.transactionNumber}`, leftX, y);
  y += 3.8;
  if (rf.date) {
    docPdf.text(`Date: ${formatDateTime(params.sale.createdAt)}`, leftX, y);
    y += 3.8;
  }
  if (rf.cashier) {
    docPdf.text(`Cashier: ${params.sale.cashierName || 'Staff'}`, leftX, y);
    y += 3.8;
  }
  if (rf.customer) {
    docPdf.text(`Customer: ${params.sale.customerName || 'Walk-in Customer'}`, leftX, y);
    y += 3.8;
  }
  docPdf.text(divider, centerX, y, { align: 'center' });
  y += 4;

  for (const item of params.items) {
    docPdf.setFont('helvetica', 'bold');
    const title =
      rf.itemSku && item.sku ? `${item.productName} (${item.sku})` : item.productName;
    docPdf.text(title.slice(0, mode === 'thermal_58' ? 24 : 34), leftX, y);
    if (!rf.itemBreakdown) {
      docPdf.text(formatMoney(item.lineTotalMinor, sym), rightX, y, { align: 'right' });
      y += 4.2;
    } else {
      y += 3.4;
      docPdf.setFont('helvetica', 'normal');
      docPdf.text(`${item.quantity} x ${formatMoney(item.unitPriceMinor, sym)}`, leftX, y);
      docPdf.text(formatMoney(item.lineTotalMinor, sym), rightX, y, { align: 'right' });
      y += 4.3;
    }
  }

  docPdf.text(divider, centerX, y, { align: 'center' });
  y += 4;
  docPdf.text('Subtotal:', leftX, y);
  docPdf.text(formatMoney(params.sale.subtotalMinor, sym), rightX, y, { align: 'right' });
  y += 3.8;
  if (rf.discount) {
    docPdf.text('Discount:', leftX, y);
    docPdf.text(`-${formatMoney(params.sale.discountMinor, sym)}`, rightX, y, { align: 'right' });
    y += 3.8;
  }
  if (rf.tax) {
    docPdf.text(`Tax (${taxTitle}):`, leftX, y);
    docPdf.text(formattedTaxDisplay, rightX, y, { align: 'right' });
    y += 3.8;
  }
  y += 0.4;
  docPdf.setFont('helvetica', 'bold');
  docPdf.setFontSize(mode === 'thermal_58' ? 8.5 : 10);
  docPdf.text('TOTAL:', leftX, y);
  docPdf.text(formatMoney(params.sale.totalMinor, sym), rightX, y, { align: 'right' });
  y += 4.8;

  docPdf.setFont('helvetica', 'normal');
  docPdf.setFontSize(mode === 'thermal_58' ? 7 : 8);
  if (rf.paymentMethod) {
    docPdf.text(`Payment: ${params.sale.paymentMethod.replace('_', ' ').toUpperCase()}`, leftX, y);
    y += 3.8;
    if (params.sale.amountTenderedMinor !== undefined) {
      docPdf.text(`Tendered: ${formatMoney(params.sale.amountTenderedMinor, sym)}`, leftX, y);
      y += 3.8;
      docPdf.text(`Change: ${formatMoney(params.sale.changeMinor || 0, sym)}`, leftX, y);
      y += 3.8;
    }
  }

  if (rf.returnPolicy && params.settings?.returnPolicy) {
    y += 2;
    const lines = docPdf.splitTextToSize(params.settings.returnPolicy, maxTextWidth);
    docPdf.text(lines, leftX, y);
    y += lines.length * 3.4;
  }
  if (rf.receiptFooter && params.settings?.receiptFooter) {
    y += 2;
    const footerLines = docPdf.splitTextToSize(params.settings.receiptFooter, maxTextWidth);
    docPdf.text(footerLines, centerX, y, { align: 'center' });
  }

  docPdf.save(`${params.sale.transactionNumber}.pdf`);
}
