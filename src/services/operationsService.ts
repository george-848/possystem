import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { getDateKey } from '../lib/money';
import type {
  PurchaseItem,
  TransferItem,
} from '../types/pos';
import { cleanOptional, createNotification, makeId, recordAuditLog } from './auditService';

// ============================================================================
// CUSTOMERS
// ============================================================================
export async function createCustomer(
  organizationId: string,
  branchId: string,
  data: { fullName: string; phone?: string; email?: string; address?: string }
): Promise<string> {
  const customerId = makeId('cus');
  const path = `customers/${customerId}`;
  try {
    await setDoc(
      doc(db, 'customers', customerId),
      cleanOptional({
        customerId,
        organizationId,
        branchId,
        fullName: data.fullName.trim(),
        phone: data.phone?.trim(),
        email: data.email?.trim(),
        address: data.address?.trim(),
        totalPurchasesMinor: 0,
        transactionCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await recordAuditLog({
      organizationId,
      branchId,
      action: 'customer.create',
      resourceType: 'customer',
      resourceId: customerId,
      details: `Registered customer ${data.fullName}`,
    });
    return customerId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateCustomer(
  customerId: string,
  organizationId: string,
  updates: { fullName: string; phone?: string; email?: string; address?: string }
): Promise<void> {
  const path = `customers/${customerId}`;
  try {
    await updateDoc(doc(db, 'customers', customerId), {
      fullName: updates.fullName.trim(),
      phone: updates.phone?.trim() || '',
      email: updates.email?.trim() || '',
      address: updates.address?.trim() || '',
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      organizationId,
      action: 'customer.update',
      resourceType: 'customer',
      resourceId: customerId,
      details: `Updated customer ${updates.fullName}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ============================================================================
// SUPPLIERS
// ============================================================================
export async function createSupplier(
  organizationId: string,
  data: {
    name: string;
    contactPerson?: string;
    phone?: string;
    email?: string;
    address?: string;
    taxId?: string;
  }
): Promise<string> {
  const supplierId = makeId('sup');
  const path = `suppliers/${supplierId}`;
  try {
    await setDoc(
      doc(db, 'suppliers', supplierId),
      cleanOptional({
        supplierId,
        organizationId,
        name: data.name.trim(),
        contactPerson: data.contactPerson?.trim(),
        phone: data.phone?.trim(),
        email: data.email?.trim(),
        address: data.address?.trim(),
        taxId: data.taxId?.trim(),
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await recordAuditLog({
      organizationId,
      action: 'supplier.create',
      resourceType: 'supplier',
      resourceId: supplierId,
      details: `Created supplier ${data.name}`,
    });
    return supplierId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSupplier(
  supplierId: string,
  organizationId: string,
  updates: Partial<{
    name: string;
    contactPerson: string;
    phone: string;
    email: string;
    address: string;
    taxId: string;
    status: 'active' | 'inactive';
  }>
): Promise<void> {
  const path = `suppliers/${supplierId}`;
  try {
    await updateDoc(doc(db, 'suppliers', supplierId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      organizationId,
      action: 'supplier.update',
      resourceType: 'supplier',
      resourceId: supplierId,
      details: `Updated supplier ${supplierId}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ============================================================================
// PURCHASES & GOODS RECEIVING
// ============================================================================
export async function createPurchaseOrder(params: {
  organizationId: string;
  branchId: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber?: string;
  submitForApproval: boolean;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitCostMinor: number;
    discountMinor: number;
    taxMinor: number;
  }>;
}): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  if (params.items.length === 0) throw new Error('Add at least one item to purchase order.');

  const purchaseId = makeId('po');
  const purchaseNumber = `PO-${getDateKey().replace(/-/g, '')}-${purchaseId.slice(-5).toUpperCase()}`;
  const path = `purchases/${purchaseId}`;

  let subtotalMinor = 0;
  let discountMinor = 0;
  let taxMinor = 0;
  for (const i of params.items) {
    subtotalMinor += i.quantity * i.unitCostMinor;
    discountMinor += i.discountMinor;
    taxMinor += i.taxMinor;
  }
  const totalMinor = Math.max(0, subtotalMinor - discountMinor + taxMinor);

  try {
    await setDoc(
      doc(db, 'purchases', purchaseId),
      cleanOptional({
        purchaseId,
        purchaseNumber,
        organizationId: params.organizationId,
        branchId: params.branchId,
        supplierId: params.supplierId,
        supplierName: params.supplierName,
        invoiceNumber: params.invoiceNumber?.trim(),
        subtotalMinor,
        discountMinor,
        taxMinor,
        totalMinor,
        paidMinor: 0,
        status: params.submitForApproval ? 'pending_approval' : 'draft',
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    for (const i of params.items) {
      const itemId = makeId('poi');
      const lineTotalMinor = Math.max(0, i.quantity * i.unitCostMinor - i.discountMinor + i.taxMinor);
      await setDoc(doc(db, 'purchases', purchaseId, 'items', itemId), {
        itemId,
        purchaseId,
        organizationId: params.organizationId,
        branchId: params.branchId,
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
        unitCostMinor: i.unitCostMinor,
        discountMinor: i.discountMinor,
        taxMinor: i.taxMinor,
        lineTotalMinor,
      });
    }

    await recordAuditLog({
      organizationId: params.organizationId,
      branchId: params.branchId,
      action: 'purchase.create',
      resourceType: 'purchase',
      resourceId: purchaseId,
      details: `Created PO ${purchaseNumber} for ${params.supplierName}`,
    });

    return purchaseId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function fetchPurchaseItems(
  purchaseId: string,
  organizationId: string
): Promise<PurchaseItem[]> {
  const path = `purchases/${purchaseId}/items`;
  try {
    const snap = await getDocs(
      query(
        collection(db, 'purchases', purchaseId, 'items'),
        where('organizationId', '==', organizationId)
      )
    );
    return snap.docs.map((d) => d.data() as PurchaseItem);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function updatePurchaseWorkflow(params: {
  purchaseId: string;
  organizationId: string;
  branchId: string;
  action: 'submit' | 'approve' | 'reject' | 'receive' | 'record_payment';
  paidMinor?: number;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  const path = `purchases/${params.purchaseId}`;

  if (params.action !== 'receive') {
    try {
      const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (params.action === 'submit') updates.status = 'pending_approval';
      if (params.action === 'approve') {
        updates.status = 'approved';
        updates.approvedBy = currentUser.uid;
      }
      if (params.action === 'reject') {
        updates.status = 'rejected';
        updates.approvedBy = currentUser.uid;
      }
      if (params.action === 'record_payment' && params.paidMinor !== undefined) {
        updates.paidMinor = Math.max(0, Math.round(params.paidMinor));
      }
      await updateDoc(doc(db, 'purchases', params.purchaseId), updates);
      await recordAuditLog({
        organizationId: params.organizationId,
        branchId: params.branchId,
        action: `purchase.${params.action}`,
        resourceType: 'purchase',
        resourceId: params.purchaseId,
        details: `Purchase ${params.purchaseId} action: ${params.action}`,
      });
      return;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  // Receive Goods atomically into branchInventory
  const poItems = await fetchPurchaseItems(params.purchaseId, params.organizationId);
  try {
    await runTransaction(db, async (tx) => {
      const poRef = doc(db, 'purchases', params.purchaseId);
      const invRefs = poItems.map((item) =>
        doc(db, 'branchInventory', `${params.branchId}_${item.productId}`)
      );
      const prodRefs = poItems.map((item) => doc(db, 'products', item.productId));

      const [poSnap, ...otherSnaps] = await Promise.all([
        tx.get(poRef),
        ...invRefs.map((r) => tx.get(r)),
        ...prodRefs.map((r) => tx.get(r)),
      ]);

      if (!poSnap.exists()) throw new Error('Purchase order not found.');
      const po = poSnap.data();
      if (po.status !== 'approved') {
        throw new Error('Only approved purchase orders can be received into inventory.');
      }

      const invSnaps = otherSnaps.slice(0, poItems.length);
      const prodSnaps = otherSnaps.slice(poItems.length);

      for (let i = 0; i < poItems.length; i++) {
        const item = poItems[i];
        const invSnap = invSnaps[i];
        const prodSnap = prodSnaps[i];
        const prod = prodSnap.exists() ? prodSnap.data() : null;
        const prevQty = invSnap.exists() ? Number(invSnap.data().quantityAvailable || 0) : 0;
        const newQty = prevQty + item.quantity;

        if (invSnap.exists()) {
          tx.update(invRefs[i], {
            quantityAvailable: newQty,
            costPriceMinor: item.unitCostMinor,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(invRefs[i], {
            inventoryId: `${params.branchId}_${item.productId}`,
            organizationId: params.organizationId,
            branchId: params.branchId,
            productId: item.productId,
            quantityAvailable: newQty,
            reorderLevel: Number(prod?.minimumStock ?? 5),
            costPriceMinor: item.unitCostMinor,
            sellingPriceMinor: Number(prod?.sellingPriceMinor ?? item.unitCostMinor),
            updatedAt: serverTimestamp(),
          });
        }

        const movementId = makeId('mov');
        tx.set(doc(db, 'stockMovements', movementId), {
          movementId,
          organizationId: params.organizationId,
          branchId: params.branchId,
          productId: item.productId,
          movementType: 'purchase_receipt',
          quantity: item.quantity,
          previousQuantity: prevQty,
          newQuantity: newQty,
          referenceType: 'purchase',
          referenceId: params.purchaseId,
          reason: `Goods received for ${po.purchaseNumber}`,
          performedBy: currentUser.uid,
          createdAt: serverTimestamp(),
        });
      }

      tx.update(poRef, {
        status: 'received',
        receivedBy: currentUser.uid,
        updatedAt: serverTimestamp(),
      });
    });

    await createNotification({
      organizationId: params.organizationId,
      branchId: params.branchId,
      type: 'purchase_completed',
      title: 'Purchase Goods Received',
      message: `Purchase order ${params.purchaseId} received into branch stock.`,
    });

    await recordAuditLog({
      organizationId: params.organizationId,
      branchId: params.branchId,
      action: 'purchase.receive',
      resourceType: 'purchase',
      resourceId: params.purchaseId,
      details: `Received ${poItems.length} line items into branch ${params.branchId}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ============================================================================
// INTER-BRANCH STOCK TRANSFERS
// ============================================================================
export async function createStockTransfer(params: {
  organizationId: string;
  sourceBranchId: string;
  destinationBranchId: string;
  notes?: string;
  submitForApproval: boolean;
  items: Array<{ productId: string; productName: string; requestedQuantity: number }>;
}): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  if (params.sourceBranchId === params.destinationBranchId) {
    throw new Error('Source and destination branches must be different.');
  }
  if (params.items.length === 0) throw new Error('Select at least one product to transfer.');

  const transferId = makeId('trf');
  const transferNumber = `TRF-${getDateKey().replace(/-/g, '')}-${transferId.slice(-5).toUpperCase()}`;
  const path = `stockTransfers/${transferId}`;

  try {
    await setDoc(
      doc(db, 'stockTransfers', transferId),
      cleanOptional({
        transferId,
        transferNumber,
        organizationId: params.organizationId,
        sourceBranchId: params.sourceBranchId,
        destinationBranchId: params.destinationBranchId,
        status: params.submitForApproval ? 'pending_approval' : 'draft',
        notes: params.notes?.trim(),
        requestedBy: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    for (const item of params.items) {
      const itemId = makeId('tri');
      await setDoc(doc(db, 'stockTransfers', transferId, 'items', itemId), {
        itemId,
        transferId,
        organizationId: params.organizationId,
        productId: item.productId,
        productName: item.productName,
        requestedQuantity: item.requestedQuantity,
        receivedQuantity: 0,
        damagedQuantity: 0,
      });
    }

    await createNotification({
      organizationId: params.organizationId,
      branchId: params.destinationBranchId,
      type: 'stock_transfer',
      title: `New Stock Transfer ${transferNumber}`,
      message: `Transfer request created from ${params.sourceBranchId} to ${params.destinationBranchId}.`,
    });

    await recordAuditLog({
      organizationId: params.organizationId,
      branchId: params.sourceBranchId,
      action: 'transfer.create',
      resourceType: 'stockTransfer',
      resourceId: transferId,
      details: `Created transfer ${transferNumber} (${params.sourceBranchId} -> ${params.destinationBranchId})`,
    });

    return transferId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function fetchTransferItems(
  transferId: string,
  organizationId: string
): Promise<TransferItem[]> {
  const path = `stockTransfers/${transferId}/items`;
  try {
    const snap = await getDocs(
      query(
        collection(db, 'stockTransfers', transferId, 'items'),
        where('organizationId', '==', organizationId)
      )
    );
    return snap.docs.map((d) => d.data() as TransferItem);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function transitionStockTransfer(params: {
  transferId: string;
  organizationId: string;
  action: 'submit' | 'approve' | 'reject' | 'cancel' | 'dispatch' | 'receive';
  receipts?: Array<{ itemId: string; receivedQuantity: number; damagedQuantity: number }>;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  const path = `stockTransfers/${params.transferId}`;

  if (['submit', 'approve', 'reject', 'cancel'].includes(params.action)) {
    const statusMap: Record<string, string> = {
      submit: 'pending_approval',
      approve: 'approved',
      reject: 'rejected',
      cancel: 'cancelled',
    };
    try {
      const updates: Record<string, unknown> = {
        status: statusMap[params.action],
        updatedAt: serverTimestamp(),
      };
      if (params.action === 'approve' || params.action === 'reject') {
        updates.approvedBy = currentUser.uid;
      }
      await updateDoc(doc(db, 'stockTransfers', params.transferId), updates);
      await recordAuditLog({
        organizationId: params.organizationId,
        action: `transfer.${params.action}`,
        resourceType: 'stockTransfer',
        resourceId: params.transferId,
        details: `Stock transfer ${params.transferId} -> ${statusMap[params.action]}`,
      });
      return;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  const items = await fetchTransferItems(params.transferId, params.organizationId);

  try {
    await runTransaction(db, async (tx) => {
      const trfRef = doc(db, 'stockTransfers', params.transferId);
      const trfSnap = await tx.get(trfRef);
      if (!trfSnap.exists()) throw new Error('Stock transfer not found.');
      const trf = trfSnap.data();

      if (params.action === 'dispatch') {
        if (trf.status !== 'approved') {
          throw new Error('Only approved transfers can be dispatched.');
        }
        const orgRef = doc(db, 'organizations', params.organizationId);
        const invRefs = items.map((it) =>
          doc(db, 'branchInventory', `${trf.sourceBranchId}_${it.productId}`)
        );
        const [orgSnap, ...invSnaps] = await Promise.all([
          tx.get(orgRef),
          ...invRefs.map((r) => tx.get(r)),
        ]);
        const allowNegative = Boolean(orgSnap.data()?.allowNegativeInventory);

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const invSnap = invSnaps[i];
          const prevQty = invSnap.exists() ? Number(invSnap.data().quantityAvailable || 0) : 0;
          const newQty = prevQty - item.requestedQuantity;
          if (!allowNegative && newQty < 0) {
            throw new Error(
              `Insufficient source branch stock for ${item.productName} (available ${prevQty}, requested ${item.requestedQuantity}).`
            );
          }
          tx.update(invRefs[i], {
            quantityAvailable: newQty,
            updatedAt: serverTimestamp(),
          });
          const movementId = makeId('mov');
          tx.set(doc(db, 'stockMovements', movementId), {
            movementId,
            organizationId: params.organizationId,
            branchId: trf.sourceBranchId,
            productId: item.productId,
            movementType: 'transfer_out',
            quantity: -item.requestedQuantity,
            previousQuantity: prevQty,
            newQuantity: newQty,
            referenceType: 'stockTransfer',
            referenceId: params.transferId,
            reason: `Dispatched transfer ${trf.transferNumber}`,
            performedBy: currentUser.uid,
            createdAt: serverTimestamp(),
          });
        }

        tx.update(trfRef, {
          status: 'dispatched',
          dispatchedBy: currentUser.uid,
          updatedAt: serverTimestamp(),
        });
        return;
      }

      if (params.action === 'receive') {
        if (trf.status !== 'dispatched' && trf.status !== 'partially_received') {
          throw new Error('Transfer must be dispatched before confirming receipt.');
        }
        const destInvRefs = items.map((it) =>
          doc(db, 'branchInventory', `${trf.destinationBranchId}_${it.productId}`)
        );
        const prodRefs = items.map((it) => doc(db, 'products', it.productId));
        const allSnaps = await Promise.all([
          ...destInvRefs.map((r) => tx.get(r)),
          ...prodRefs.map((r) => tx.get(r)),
        ]);
        const destInvSnaps = allSnaps.slice(0, items.length);
        const prodSnaps = allSnaps.slice(items.length);

        let allFullyReceived = true;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const recEntry = params.receipts?.find((r) => r.itemId === item.itemId);
          const recQty = recEntry ? recEntry.receivedQuantity : item.requestedQuantity;
          const dmgQty = recEntry ? recEntry.damagedQuantity : 0;
          if (recQty + dmgQty < item.requestedQuantity) {
            allFullyReceived = false;
          }

          const destSnap = destInvSnaps[i];
          const prod = prodSnaps[i].exists() ? prodSnaps[i].data() : null;
          const prevQty = destSnap.exists() ? Number(destSnap.data().quantityAvailable || 0) : 0;
          const newQty = prevQty + recQty;

          if (destSnap.exists()) {
            tx.update(destInvRefs[i], {
              quantityAvailable: newQty,
              updatedAt: serverTimestamp(),
            });
          } else {
            tx.set(destInvRefs[i], {
              inventoryId: `${trf.destinationBranchId}_${item.productId}`,
              organizationId: params.organizationId,
              branchId: trf.destinationBranchId,
              productId: item.productId,
              quantityAvailable: newQty,
              reorderLevel: Number(prod?.minimumStock ?? 5),
              costPriceMinor: Number(prod?.costPriceMinor ?? 0),
              sellingPriceMinor: Number(prod?.sellingPriceMinor ?? 0),
              updatedAt: serverTimestamp(),
            });
          }

          tx.update(doc(db, 'stockTransfers', params.transferId, 'items', item.itemId), {
            receivedQuantity: recQty,
            damagedQuantity: dmgQty,
          });

          const movementId = makeId('mov');
          tx.set(doc(db, 'stockMovements', movementId), {
            movementId,
            organizationId: params.organizationId,
            branchId: trf.destinationBranchId,
            productId: item.productId,
            movementType: 'transfer_in',
            quantity: recQty,
            previousQuantity: prevQty,
            newQuantity: newQty,
            referenceType: 'stockTransfer',
            referenceId: params.transferId,
            reason: `Received transfer ${trf.transferNumber} (damaged/shortage: ${dmgQty})`,
            performedBy: currentUser.uid,
            createdAt: serverTimestamp(),
          });
        }

        tx.update(trfRef, {
          status: allFullyReceived ? 'received' : 'partially_received',
          receivedBy: currentUser.uid,
          updatedAt: serverTimestamp(),
        });
      }
    });

    await recordAuditLog({
      organizationId: params.organizationId,
      action: `transfer.${params.action}`,
      resourceType: 'stockTransfer',
      resourceId: params.transferId,
      details: `Executed ${params.action} on transfer ${params.transferId}`,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Insufficient source branch stock')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ============================================================================
// CASH REGISTER SESSIONS
// ============================================================================
export async function openCashSession(params: {
  organizationId: string;
  branchId: string;
  cashierName: string;
  openingBalanceMinor: number;
}): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  const sessionId = makeId('cs');
  const path = `cashSessions/${sessionId}`;

  const safeOpeningMinor = Math.max(0, Math.round(Number(params.openingBalanceMinor) || 0));

  try {
    await setDoc(
      doc(db, 'cashSessions', sessionId),
      cleanOptional({
        sessionId,
        organizationId: params.organizationId,
        branchId: params.branchId,
        cashierId: currentUser.uid,
        cashierName: params.cashierName?.trim() || undefined,
        openingBalanceMinor: safeOpeningMinor,
        cashSalesMinor: 0,
        cashRefundsMinor: 0,
        cashDepositsMinor: 0,
        cashWithdrawalsMinor: 0,
        expectedClosingBalanceMinor: safeOpeningMinor,
        status: 'open',
        openedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await recordAuditLog({
      organizationId: params.organizationId,
      branchId: params.branchId,
      action: 'cashSession.open',
      resourceType: 'cashSession',
      resourceId: sessionId,
      details: `Opened cash shift with opening float ${params.openingBalanceMinor}`,
    });
    return sessionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function recordCashMovement(params: {
  sessionId: string;
  organizationId: string;
  branchId: string;
  type: 'deposit' | 'withdrawal';
  amountMinor: number;
  notes?: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  const path = `cashSessions/${params.sessionId}`;
  const txId = makeId('cstx');

  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'cashSessions', params.sessionId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Cash session not found.');
      const data = snap.data();
      if (data.status !== 'open') throw new Error('Cash session is already closed.');

      const amt = Math.max(0, Math.round(params.amountMinor));
      const nextDeposits =
        Number(data.cashDepositsMinor || 0) + (params.type === 'deposit' ? amt : 0);
      const nextWithdrawals =
        Number(data.cashWithdrawalsMinor || 0) + (params.type === 'withdrawal' ? amt : 0);
      const nextExpected =
        Number(data.expectedClosingBalanceMinor || 0) +
        (params.type === 'deposit' ? amt : -amt);

      tx.update(ref, {
        cashDepositsMinor: nextDeposits,
        cashWithdrawalsMinor: nextWithdrawals,
        expectedClosingBalanceMinor: nextExpected,
        updatedAt: serverTimestamp(),
      });

      tx.set(
        doc(db, 'cashSessions', params.sessionId, 'transactions', txId),
        cleanOptional({
          transactionId: txId,
          sessionId: params.sessionId,
          organizationId: params.organizationId,
          branchId: params.branchId,
          type: params.type,
          amountMinor: amt,
          notes: params.notes?.trim(),
          performedBy: currentUser.uid,
          createdAt: serverTimestamp(),
        })
      );
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function closeCashSession(params: {
  sessionId: string;
  organizationId: string;
  branchId: string;
  actualClosingBalanceMinor: number;
}): Promise<{ differenceMinor: number }> {
  const path = `cashSessions/${params.sessionId}`;
  let diff = 0;

  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'cashSessions', params.sessionId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Cash session not found.');
      const data = snap.data();
      if (data.status !== 'open') throw new Error('Cash session is already closed.');

      const actual = Math.max(0, Math.round(params.actualClosingBalanceMinor));
      const expected = Number(data.expectedClosingBalanceMinor || 0);
      diff = actual - expected;

      tx.update(ref, {
        actualClosingBalanceMinor: actual,
        differenceMinor: diff,
        status: 'closed',
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    if (diff !== 0) {
      await createNotification({
        organizationId: params.organizationId,
        branchId: params.branchId,
        type: 'cash_discrepancy',
        title: 'Cash Drawer Discrepancy Detected',
        message: `Shift ${params.sessionId} closed with variance of ${diff} minor units.`,
      });
    }

    await recordAuditLog({
      organizationId: params.organizationId,
      branchId: params.branchId,
      action: 'cashSession.close',
      resourceType: 'cashSession',
      resourceId: params.sessionId,
      details: `Closed cash session with differenceMinor=${diff}`,
    });

    return { differenceMinor: diff };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function approveCashSession(
  sessionId: string,
  organizationId: string,
  branchId: string
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  const path = `cashSessions/${sessionId}`;
  try {
    await updateDoc(doc(db, 'cashSessions', sessionId), {
      status: 'approved',
      approvedBy: currentUser.uid,
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      organizationId,
      branchId,
      action: 'cashSession.approve',
      resourceType: 'cashSession',
      resourceId: sessionId,
      details: `Supervisor approved closed cash session ${sessionId}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ============================================================================
// EXPENSES
// ============================================================================
export async function createExpense(params: {
  organizationId: string;
  branchId: string;
  category: string;
  description: string;
  amountMinor: number;
  expenseDate: string;
  attachmentNote?: string;
}): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  const expenseId = makeId('exp');
  const path = `expenses/${expenseId}`;

  try {
    await setDoc(
      doc(db, 'expenses', expenseId),
      cleanOptional({
        expenseId,
        organizationId: params.organizationId,
        branchId: params.branchId,
        category: params.category.trim(),
        description: params.description.trim(),
        amountMinor: Math.max(0, Math.round(params.amountMinor)),
        expenseDate: params.expenseDate,
        attachmentNote: params.attachmentNote?.trim(),
        submittedBy: currentUser.uid,
        approvalStatus: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await recordAuditLog({
      organizationId: params.organizationId,
      branchId: params.branchId,
      action: 'expense.create',
      resourceType: 'expense',
      resourceId: expenseId,
      details: `Submitted ${params.category} expense: ${params.description}`,
    });
    return expenseId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function decideExpense(params: {
  expenseId: string;
  organizationId: string;
  branchId: string;
  decision: 'approved' | 'rejected';
  amountMinor: number;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');
  const path = `expenses/${params.expenseId}`;
  const dateKey = getDateKey();
  const summaryId = `${params.branchId}_${dateKey}`;

  try {
    await runTransaction(db, async (tx) => {
      const expRef = doc(db, 'expenses', params.expenseId);
      const sumRef = doc(db, 'branchDailySummaries', summaryId);
      const [expSnap, sumSnap] = await Promise.all([tx.get(expRef), tx.get(sumRef)]);
      if (!expSnap.exists()) throw new Error('Expense not found.');
      if (expSnap.data().approvalStatus !== 'pending') {
        throw new Error('Expense decision already recorded.');
      }

      tx.update(expRef, {
        approvalStatus: params.decision,
        approvedBy: currentUser.uid,
        updatedAt: serverTimestamp(),
      });

      if (params.decision === 'approved') {
        if (sumSnap.exists()) {
          const prev = sumSnap.data();
          tx.update(sumRef, {
            expensesMinor: Number(prev.expensesMinor || 0) + params.amountMinor,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(sumRef, {
            summaryId,
            organizationId: params.organizationId,
            branchId: params.branchId,
            dateKey,
            salesCount: 0,
            revenueMinor: 0,
            cogsMinor: 0,
            discountsMinor: 0,
            refundsMinor: 0,
            expensesMinor: params.amountMinor,
            updatedAt: serverTimestamp(),
          });
        }
      }
    });

    await recordAuditLog({
      organizationId: params.organizationId,
      branchId: params.branchId,
      action: `expense.${params.decision}`,
      resourceType: 'expense',
      resourceId: params.expenseId,
      details: `Expense ${params.expenseId} ${params.decision}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
