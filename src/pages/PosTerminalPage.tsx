import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Barcode,
  Camera,
  CheckCircle2,
  CreditCard,
  Minus,
  Monitor,
  Package,
  PauseCircle,
  Percent,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
  Volume2,
  VolumeX,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  BarcodeScannerModal,
  type ScanFeedbackState,
} from '../components/BarcodeScannerModal';
import {
  HeldOrdersModal,
  HoldOrderModal,
  RecentReceiptsModal,
  ShiftDrawerModal,
  loadHeldOrders,
  saveHeldOrders,
  type HeldOrderRecord,
} from '../components/PosTerminalModals';
import { ReceiptModal } from '../components/ReceiptModal';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useEntitlements } from '../contexts/EntitlementContext';
import { useToast } from '../contexts/ToastContext';
import {
  findProductByScanCode,
  isProductAvailableAtBranch,
  parseScanInput,
  playScannerTone,
} from '../lib/barcode';
import {
  calculateLineAmounts,
  calculateOrderTotals,
  formatMoney,
  formatTaxDisplayValue,
  fromMinorUnits,
  toMinorUnits,
} from '../lib/money';
import { sanitizeHttpUrl } from '../lib/url';
import { makeId } from '../services/auditService';
import { createCustomer } from '../services/operationsService';
import { fetchSaleItems, processPosSale, type PosPaymentSplit } from '../services/posService';
import type { Product, Sale, SaleItem, SinglePaymentMethod } from '../types/pos';

interface CartLine {
  product: Product;
  quantity: number;
  unitPriceMinor: number;
  costPriceMinor: number;
  discountMinor: number;
  availableStock: number;
}

export function PosTerminalPage() {
  const {
    userProfile,
    organization,
    activeBranchId,
    activeBranch,
    systemSettings,
    hasPermission,
  } = useAuth();
  const { products, categories, branchInventory, customers, cashSessions, sales } = useData();
  const { terminals, entitlements } = useEntitlements();
  const { notify } = useToast();

  const branchTerminals = useMemo(
    () => terminals.filter((t) => t.branchId === activeBranchId && t.status === 'active'),
    [terminals, activeBranchId]
  );
  const [selectedTerminalId, setSelectedTerminalId] = useState('');
  useEffect(() => {
    if (branchTerminals.length > 0 && !branchTerminals.some((t) => t.terminalId === selectedTerminalId)) {
      setSelectedTerminalId(branchTerminals[0].terminalId);
    } else if (branchTerminals.length === 0) {
      setSelectedTerminalId('');
    }
  }, [branchTerminals, selectedTerminalId]);

  const [barcodeInput, setBarcodeInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderDiscountInput, setOrderDiscountInput] = useState('0');
  const [orderNote, setOrderNote] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => makeId('idem'));

  // Hold / Park orders
  const [heldOrders, setHeldOrders] = useState<HeldOrderRecord[]>([]);
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showHeldOrders, setShowHeldOrders] = useState(false);

  // Recent branch receipts & shift drawer peek
  const [showRecentReceipts, setShowRecentReceipts] = useState(false);
  const [loadingReprintId, setLoadingReprintId] = useState<string | null>(null);
  const [showShiftDrawer, setShowShiftDrawer] = useState(false);

  // Barcode utility states
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const cartRef = useRef<CartLine[]>(cart);
  cartRef.current = cart;
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [wedgeEnabled, setWedgeEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastScan, setLastScan] = useState<ScanFeedbackState | null>(null);
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);

  // Quick customer modal
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');

  // Payment modal
  const [showPayment, setShowPayment] = useState(false);
  const [splitPayments, setSplitPayments] = useState<
    Array<{ method: SinglePaymentMethod; amountStr: string; reference: string }>
  >([{ method: 'cash', amountStr: '', reference: '' }]);
  const [activeSplitIdx, setActiveSplitIdx] = useState(0);
  const [processingSale, setProcessingSale] = useState(false);

  // Receipt modal
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null);
  const [receiptItems, setReceiptItems] = useState<SaleItem[]>([]);

  const sym = organization?.currencySymbol || 'GH₵';
  const defaultTaxRateBps = organization?.defaultTaxRateBps || 0;
  const taxIncludedInPrice = Boolean(systemSettings?.taxIncludedInPrice);
  const allowNegative = Boolean(organization?.allowNegativeInventory);
  const canApplyDiscounts = hasPermission('sales.edit');
  const maxDiscountPct = systemSettings?.maxCashierDiscountPct ?? 10;
  const supportedMethods = systemSettings?.supportedPaymentMethods || [
    'cash',
    'mobile_money',
    'card',
    'bank_transfer',
  ];

  const activeCashSession = useMemo(
    () =>
      cashSessions.find(
        (c) =>
          c.branchId === activeBranchId &&
          c.cashierId === userProfile?.uid &&
          c.status === 'open'
      ) || null,
    [cashSessions, activeBranchId, userProfile]
  );

  const branchSales = useMemo(
    () => sales.filter((s) => s.branchId === activeBranchId),
    [sales, activeBranchId]
  );

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.customerId === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  // Sync parked/held orders for current organization + branch
  useEffect(() => {
    if (!organization?.organizationId || !activeBranchId) {
      setHeldOrders([]);
      return;
    }
    setHeldOrders(loadHeldOrders(organization.organizationId, activeBranchId));
  }, [organization?.organizationId, activeBranchId]);

  const persistHeldOrders = useCallback(
    (next: HeldOrderRecord[]) => {
      setHeldOrders(next);
      if (organization?.organizationId && activeBranchId) {
        saveHeldOrders(organization.organizationId, activeBranchId, next);
      }
    },
    [organization?.organizationId, activeBranchId]
  );

  const inventoryByProduct = useMemo(() => {
    const map = new Map<string, (typeof branchInventory)[number]>();
    for (const inv of branchInventory) {
      if (inv.branchId === activeBranchId) {
        map.set(inv.productId, inv);
      }
    }
    return map;
  }, [branchInventory, activeBranchId]);

  const branchProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!isProductAvailableAtBranch(p, activeBranchId)) return false;
      if (selectedCategory !== 'all' && p.categoryId !== selectedCategory) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
      );
    });
  }, [products, activeBranchId, selectedCategory, search]);

  const scanLookupMap = useMemo(() => {
    const map = new Map<string, Product>();
    // Populate SKUs first so exact barcodes always take precedence if they overlap
    for (const p of products) {
      if (!isProductAvailableAtBranch(p, activeBranchId)) continue;
      const skuKey = p.sku.trim().toLowerCase();
      if (skuKey) map.set(skuKey, p);
    }
    for (const p of products) {
      if (!isProductAvailableAtBranch(p, activeBranchId)) continue;
      if (p.barcode) {
        const bcKey = p.barcode.trim().toLowerCase();
        if (bcKey) map.set(bcKey, p);
      }
    }
    return map;
  }, [products, activeBranchId]);

  const highlightCartProduct = useCallback((productId: string) => {
    setHighlightedProductId(productId);
    window.setTimeout(() => {
      setHighlightedProductId((prev) => (prev === productId ? null : prev));
    }, 1400);
  }, []);

  const addProductToCart = useCallback(
    (product: Product, quantityToAdd = 1): { ok: boolean; reason?: string } => {
      const inv = inventoryByProduct.get(product.productId);
      if (!inv) {
        const reason = `${product.name} has not been stocked at ${activeBranch?.branchName || 'this branch'}.`;
        notify('error', 'No Branch Stock Record', reason);
        return { ok: false, reason };
      }

      const currentCart = cartRef.current;
      const existing = currentCart.find((c) => c.product.productId === product.productId);
      const nextQty = (existing?.quantity || 0) + quantityToAdd;
      if (!allowNegative && nextQty > inv.quantityAvailable) {
        const reason = `Only ${inv.quantityAvailable} unit(s) of ${product.name} available at this branch.`;
        notify('error', 'Insufficient Stock', reason);
        return { ok: false, reason };
      }

      const nextCart = existing
        ? currentCart.map((c) =>
            c.product.productId === product.productId
              ? { ...c, quantity: nextQty, availableStock: inv.quantityAvailable }
              : c
          )
        : [
            ...currentCart,
            {
              product,
              quantity: quantityToAdd,
              unitPriceMinor: inv.sellingPriceMinor ?? product.sellingPriceMinor,
              costPriceMinor: inv.costPriceMinor ?? product.costPriceMinor,
              discountMinor: 0,
              availableStock: inv.quantityAvailable,
            },
          ];

      cartRef.current = nextCart;
      setCart(nextCart);

      highlightCartProduct(product.productId);
      return { ok: true };
    },
    [inventoryByProduct, activeBranch, allowNegative, notify, highlightCartProduct]
  );

  const processScannedCode = useCallback(
    (rawInput: string): boolean => {
      const { code, quantity } = parseScanInput(rawInput);
      if (!code) return false;

      const normalized = code.toLowerCase();
      const matched =
        scanLookupMap.get(normalized) ||
        findProductByScanCode(products, activeBranchId, code);

      if (!matched) {
        if (soundEnabled) playScannerTone('error');
        const message = `No active branch product matches "${code}".`;
        setLastScan({
          status: 'error',
          code,
          message,
          timestamp: Date.now(),
        });
        notify('error', 'Barcode Not Found', message);
        return false;
      }

      const result = addProductToCart(matched, quantity);
      if (!result.ok) {
        if (soundEnabled) playScannerTone('error');
        setLastScan({
          status: 'error',
          code,
          message: result.reason || 'Unable to add scanned product.',
          timestamp: Date.now(),
        });
        return false;
      }

      if (soundEnabled) playScannerTone('success');
      const inv = inventoryByProduct.get(matched.productId);
      const unitPrice = inv?.sellingPriceMinor ?? matched.sellingPriceMinor;
      setLastScan({
        status: 'success',
        code: matched.barcode || matched.sku,
        message: `Added ${matched.name} ×${quantity} (${formatMoney(unitPrice * quantity, sym)})`,
        timestamp: Date.now(),
      });
      return true;
    },
    [
      scanLookupMap,
      products,
      activeBranchId,
      soundEnabled,
      addProductToCart,
      notify,
      inventoryByProduct,
      sym,
    ]
  );

  const processScannedCodeRef = useRef(processScannedCode);
  processScannedCodeRef.current = processScannedCode;

  const anyModalOpen =
    showPayment ||
    showNewCustomer ||
    showCameraScanner ||
    showHoldModal ||
    showHeldOrders ||
    showRecentReceipts ||
    showShiftDrawer ||
    Boolean(receiptSale);

  const openPaymentModalRef = useRef<() => void>(() => {});

  // Global Hardware Keyboard-Wedge Scanner Listener + F2/F8/F9/Esc shortcuts
  useEffect(() => {
    let buffer = '';
    let lastKeyAt = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        barcodeInputRef.current?.focus();
        barcodeInputRef.current?.select();
        return;
      }

      if (e.key === 'Escape' && anyModalOpen) {
        e.preventDefault();
        setShowPayment(false);
        setShowNewCustomer(false);
        setShowHoldModal(false);
        setShowHeldOrders(false);
        setShowRecentReceipts(false);
        setShowShiftDrawer(false);
        return;
      }

      if (e.key === 'F8' && !anyModalOpen && cartRef.current.length > 0) {
        e.preventDefault();
        setShowHoldModal(true);
        return;
      }

      if (e.key === 'F9' && !anyModalOpen && cartRef.current.length > 0) {
        e.preventDefault();
        openPaymentModalRef.current();
        return;
      }

      if (!wedgeEnabled || anyModalOpen) {
        return;
      }

      const target = e.target as HTMLElement | null;
      const isBarcodeField = target === barcodeInputRef.current;
      const isOtherInput =
        target &&
        !isBarcodeField &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isOtherInput) {
        buffer = '';
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = Date.now();
      if (now - lastKeyAt > 75) {
        buffer = '';
      }
      lastKeyAt = now;

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (!isBarcodeField && buffer.length >= 3) {
          e.preventDefault();
          const scanned = buffer;
          buffer = '';
          processScannedCodeRef.current(scanned);
        } else {
          buffer = '';
        }
        return;
      }

      if (e.key.length === 1) {
        buffer += e.key;
        if (buffer.length > 64) {
          buffer = buffer.slice(-64);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [wedgeEnabled, anyModalOpen]);

  // Initial focus on barcode field when entering POS terminal
  useEffect(() => {
    barcodeInputRef.current?.focus();
  }, [activeBranchId]);

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;
    const added = processScannedCode(barcodeInput);
    if (added) {
      setBarcodeInput('');
    }
    barcodeInputRef.current?.focus();
  };

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.product.productId !== productId) return c;
          const next = c.quantity + delta;
          if (next <= 0) return null;
          if (!allowNegative && next > c.availableStock) {
            notify('error', 'Stock Limit Reached', `Only ${c.availableStock} available.`);
            return c;
          }
          return { ...c, quantity: next };
        })
        .filter((x): x is CartLine => x !== null)
    );
  };

  const setCartLineQty = (productId: string, rawQtyStr: string) => {
    const parsed = Number.parseInt(rawQtyStr, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setCart((prev) =>
      prev.map((c) => {
        if (c.product.productId !== productId) return c;
        if (!allowNegative && parsed > c.availableStock) {
          notify('error', 'Stock Limit Reached', `Only ${c.availableStock} available.`);
          return { ...c, quantity: Math.max(1, c.availableStock) };
        }
        return { ...c, quantity: parsed };
      })
    );
  };

  const updateLineDiscount = (productId: string, discountStr: string) => {
    if (!canApplyDiscounts) return;
    const rawMinor = Math.max(0, toMinorUnits(discountStr));
    setCart((prev) =>
      prev.map((c) => {
        if (c.product.productId !== productId) return c;
        const maxAllowed = Math.round((c.unitPriceMinor * c.quantity * maxDiscountPct) / 100);
        return { ...c, discountMinor: Math.min(rawMinor, maxAllowed) };
      })
    );
  };

  const afterLineDiscountsMinor = useMemo(
    () =>
      cart.reduce((sum, c) => {
        const gross = Math.max(0, Math.round(c.unitPriceMinor * c.quantity));
        return sum + Math.max(0, gross - c.discountMinor);
      }, 0),
    [cart]
  );

  const maxOrderDiscountMinor = useMemo(() => {
    if (!canApplyDiscounts) return 0;
    return Math.round((afterLineDiscountsMinor * maxDiscountPct) / 100);
  }, [canApplyDiscounts, afterLineDiscountsMinor, maxDiscountPct]);

  const orderDiscountMinor = useMemo(() => {
    if (!canApplyDiscounts) return 0;
    const raw = Math.max(0, toMinorUnits(orderDiscountInput));
    return Math.min(raw, maxOrderDiscountMinor);
  }, [canApplyDiscounts, orderDiscountInput, maxOrderDiscountMinor]);

  const applyOrderDiscountPct = (pct: number) => {
    if (!canApplyDiscounts) return;
    const safePct = Math.min(Math.max(0, pct), maxDiscountPct);
    const amountMinor = Math.round((afterLineDiscountsMinor * safePct) / 100);
    setOrderDiscountInput(amountMinor > 0 ? fromMinorUnits(amountMinor).toFixed(2) : '0');
  };

  const totals = useMemo(() => {
    return calculateOrderTotals(
      cart.map((c) => ({
        unitPriceMinor: c.unitPriceMinor,
        costPriceMinor: c.costPriceMinor,
        quantity: c.quantity,
        discountMinor: c.discountMinor,
        taxCategory: c.product.taxCategory,
      })),
      orderDiscountMinor,
      defaultTaxRateBps,
      taxIncludedInPrice
    );
  }, [cart, orderDiscountMinor, defaultTaxRateBps, taxIncludedInPrice]);

  const openPaymentModal = useCallback(() => {
    if (cart.length === 0) return;
    if (entitlements && !entitlements.isOperational) return;
    setSplitPayments([
      {
        method: supportedMethods[0] || 'cash',
        amountStr: fromMinorUnits(totals.totalMinor).toFixed(2),
        reference: '',
      },
    ]);
    setActiveSplitIdx(0);
    setShowPayment(true);
  }, [cart.length, entitlements, supportedMethods, totals.totalMinor]);

  openPaymentModalRef.current = openPaymentModal;

  const totalTenderedMinor = useMemo(
    () => splitPayments.reduce((s, p) => s + Math.max(0, toMinorUnits(p.amountStr)), 0),
    [splitPayments]
  );

  const remainingDueMinor = Math.max(0, totals.totalMinor - totalTenderedMinor);

  const quickCashSuggestionsMinor = useMemo(() => {
    const due = totals.totalMinor;
    if (due <= 0) return [];
    const baseBillsMinor = [1000, 2000, 5000, 10000, 20000];
    const nextTenMinor = Math.ceil(due / 1000) * 1000;
    const nextFiftyMinor = Math.ceil(due / 5000) * 5000;
    const set = new Set<number>([due, nextTenMinor, nextFiftyMinor, ...baseBillsMinor.filter((b) => b >= due)]);
    return Array.from(set).sort((a, b) => a - b).slice(0, 5);
  }, [totals.totalMinor]);

  const applyQuickTenderAmount = (amountMinor: number) => {
    setSplitPayments((prev) => {
      const targetIdx =
        prev[activeSplitIdx] !== undefined
          ? activeSplitIdx
          : Math.max(
              0,
              prev.findIndex((row) => row.method === 'cash')
            );
      return prev.map((row, idx) =>
        idx === targetIdx ? { ...row, amountStr: fromMinorUnits(amountMinor).toFixed(2) } : row
      );
    });
  };

  const handleParkOrder = (label: string, note: string) => {
    if (cart.length === 0 || !userProfile) return;
    const cust = customers.find((c) => c.customerId === selectedCustomerId);
    const parked: HeldOrderRecord = {
      holdId: makeId('hold'),
      referenceLabel: label,
      orderNote: note || undefined,
      customerId: selectedCustomerId,
      customerName: cust?.fullName,
      orderDiscountInput,
      cashierName: userProfile.fullName,
      createdAt: new Date().toISOString(),
      items: cart.map((c) => ({
        productId: c.product.productId,
        sku: c.product.sku,
        productName: c.product.name,
        quantity: c.quantity,
        unitPriceMinor: c.unitPriceMinor,
        discountMinor: c.discountMinor,
      })),
      itemCount: cart.reduce((s, c) => s + c.quantity, 0),
      totalMinor: totals.totalMinor,
    };
    persistHeldOrders([parked, ...heldOrders]);
    setCart([]);
    setOrderDiscountInput('0');
    setOrderNote('');
    setSelectedCustomerId('');
    setShowHoldModal(false);
    notify('success', 'Order Parked', `"${parked.referenceLabel}" saved to Held Orders.`);
    window.setTimeout(() => barcodeInputRef.current?.focus(), 50);
  };

  const handleResumeHeldOrder = (order: HeldOrderRecord, mode: 'replace' | 'merge') => {
    const productMap = new Map(products.map((p) => [p.productId, p]));
    const nextLines: CartLine[] = mode === 'merge' ? [...cart] : [];
    const warnings: string[] = [];

    for (const heldItem of order.items) {
      const prod = productMap.get(heldItem.productId);
      const inv = inventoryByProduct.get(heldItem.productId);
      if (!prod || !inv || !isProductAvailableAtBranch(prod, activeBranchId)) {
        warnings.push(`${heldItem.productName} is no longer stocked at this branch`);
        continue;
      }

      const existingIdx = nextLines.findIndex((l) => l.product.productId === prod.productId);
      const existingQty = existingIdx >= 0 ? nextLines[existingIdx].quantity : 0;
      let targetQty = existingQty + heldItem.quantity;

      if (!allowNegative && targetQty > inv.quantityAvailable) {
        targetQty = inv.quantityAvailable;
        if (targetQty <= existingQty) {
          warnings.push(`${prod.name} has insufficient stock (${inv.quantityAvailable} left)`);
          continue;
        }
        warnings.push(`${prod.name} adjusted to ${targetQty} available`);
      }

      const unitPriceMinor = inv.sellingPriceMinor ?? prod.sellingPriceMinor;
      const costPriceMinor = inv.costPriceMinor ?? prod.costPriceMinor;
      const maxLineDisc = Math.round((unitPriceMinor * targetQty * maxDiscountPct) / 100);
      const mergedDisc =
        existingIdx >= 0
          ? Math.min(nextLines[existingIdx].discountMinor + heldItem.discountMinor, maxLineDisc)
          : Math.min(heldItem.discountMinor, maxLineDisc);

      const lineObj: CartLine = {
        product: prod,
        quantity: targetQty,
        unitPriceMinor,
        costPriceMinor,
        discountMinor: mergedDisc,
        availableStock: inv.quantityAvailable,
      };

      if (existingIdx >= 0) {
        nextLines[existingIdx] = lineObj;
      } else {
        nextLines.push(lineObj);
      }
    }

    setCart(nextLines);
    if (mode === 'replace') {
      setOrderDiscountInput(order.orderDiscountInput || '0');
      setOrderNote(order.orderNote || '');
      setSelectedCustomerId(order.customerId || '');
    } else if (!selectedCustomerId && order.customerId) {
      setSelectedCustomerId(order.customerId);
    }

    persistHeldOrders(heldOrders.filter((h) => h.holdId !== order.holdId));
    setShowHeldOrders(false);

    if (warnings.length > 0) {
      notify('info', 'Order Resumed With Adjustments', warnings.join('; '));
    } else {
      notify('success', 'Order Resumed', `Loaded "${order.referenceLabel}" into cart.`);
    }
    window.setTimeout(() => barcodeInputRef.current?.focus(), 50);
  };

  const handleOpenRecentReceipt = async (sale: Sale) => {
    if (!organization) return;
    setLoadingReprintId(sale.saleId);
    try {
      const items = await fetchSaleItems(sale.saleId, organization.organizationId);
      setReceiptSale(sale);
      setReceiptItems(items);
      setShowRecentReceipts(false);
    } catch (err) {
      notify(
        'error',
        'Could Not Load Receipt',
        err instanceof Error ? err.message : 'Failed to fetch receipt line items.'
      );
    } finally {
      setLoadingReprintId(null);
    }
  };

  const handleCompleteSale = async () => {
    if (!organization || !userProfile || !activeBranchId) return;
    if (totalTenderedMinor < totals.totalMinor) {
      notify('error', 'Insufficient Payment', 'Tendered amount is less than Grand Total.');
      return;
    }

    const payments: PosPaymentSplit[] = splitPayments
      .map((p) => ({
        method: p.method,
        amountMinor: Math.max(0, toMinorUnits(p.amountStr)),
        reference: p.reference.trim() || undefined,
      }))
      .filter((p) => p.amountMinor > 0);

    const includesCash = payments.some((p) => p.method === 'cash');
    if (includesCash && !activeCashSession) {
      notify(
        'error',
        'Open Cash Register Required',
        'Please open a Cash Register shift before accepting cash payments.'
      );
      return;
    }

    setProcessingSale(true);
    try {
      const cust = customers.find((c) => c.customerId === selectedCustomerId);
      const res = await processPosSale({
        organizationId: organization.organizationId,
        branchId: activeBranchId,
        settingId: systemSettings?.settingId,
        cashierName: userProfile.fullName,
        cashSessionId: activeCashSession?.sessionId,
        customerId: cust?.customerId,
        customerName: cust?.fullName,
        orderDiscountMinor,
        items: cart.map((c) => ({
          productId: c.product.productId,
          productName: c.product.name,
          sku: c.product.sku,
          quantity: c.quantity,
          discountMinor: c.discountMinor,
          taxCategory: c.product.taxCategory,
        })),
        payments,
        idempotencyKey,
      });

      const syntheticSale: Sale = {
        saleId: res.saleId,
        transactionNumber: res.transactionNumber,
        idempotencyKey,
        organizationId: organization.organizationId,
        branchId: activeBranchId,
        cashierId: userProfile.uid,
        cashierName: userProfile.fullName,
        customerId: cust?.customerId,
        customerName: cust?.fullName,
        itemCount: cart.reduce((s, c) => s + c.quantity, 0),
        subtotalMinor: res.subtotalMinor,
        discountMinor: res.discountMinor,
        taxMinor: res.taxMinor,
        totalMinor: res.totalMinor,
        cogsMinor: totals.cogsMinor,
        amountTenderedMinor: res.amountTenderedMinor,
        changeMinor: res.changeMinor,
        paymentMethod: payments.length > 1 ? 'split' : payments[0].method,
        paymentStatus: 'paid',
        saleStatus: 'completed',
        createdAt: new Date(),
      };

      setReceiptSale(syntheticSale);
      setReceiptItems(res.items);
      setCart([]);
      setOrderDiscountInput('0');
      setOrderNote('');
      setSelectedCustomerId('');
      setShowPayment(false);
      setIdempotencyKey(makeId('idem'));
      notify('success', 'Sale Completed', `Receipt ${res.transactionNumber} recorded.`);
    } catch (err) {
      notify(
        'error',
        'Checkout Failed',
        err instanceof Error ? err.message : 'Unable to complete transaction.'
      );
    } finally {
      setProcessingSale(false);
    }
  };

  const handleQuickCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !activeBranchId || !newCustName.trim()) return;
    try {
      const id = await createCustomer(organization.organizationId, activeBranchId, {
        fullName: newCustName,
        phone: newCustPhone,
      });
      setSelectedCustomerId(id);
      setNewCustName('');
      setNewCustPhone('');
      setShowNewCustomer(false);
      notify('success', 'Customer Registered', 'Customer attached to current sale.');
    } catch (err) {
      notify('error', 'Failed', err instanceof Error ? err.message : 'Error creating customer');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
      {/* Left: Catalog & Barcode Scanner */}
      <div className="xl:col-span-8 space-y-4">
        {!activeCashSession && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-amber-900">
              No active cash register shift is open for your user at{' '}
              <strong>{activeBranch?.branchName}</strong>. Cash payments require an open shift.
            </p>
            <Link
              to="/cash-register"
              className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-medium hover:bg-amber-800 whitespace-nowrap"
            >
              Open Shift
            </Link>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          {/* Barcode Scanner Utility Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Barcode className="w-4 h-4 text-emerald-600" />
                Barcode Scanner Utility
              </span>
              {branchTerminals.length > 0 && (
                <div className="inline-flex items-center gap-1.5 ml-2">
                  <Monitor className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    aria-label="Active POS Terminal"
                    value={selectedTerminalId}
                    onChange={(e) => setSelectedTerminalId(e.target.value)}
                    className="px-2 py-0.5 text-[11px] font-medium bg-slate-50 border border-slate-200 rounded text-slate-700"
                  >
                    {branchTerminals.map((t) => (
                      <option key={t.terminalId} value={t.terminalId}>
                        {t.terminalCode} · {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <span className="text-[11px] text-slate-400 hidden xl:inline">
                <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono">F2</kbd> scan ·{' '}
                <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono">F8</kbd> hold ·{' '}
                <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono">F9</kbd> pay
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowHeldOrders(true)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap ${
                  heldOrders.length > 0
                    ? 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                Held ({heldOrders.length})
              </button>
              <button
                type="button"
                onClick={() => setShowRecentReceipts(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                Recent Sales
              </button>
              <button
                type="button"
                onClick={() => setShowShiftDrawer(true)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap ${
                  activeCashSession
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
                title="View active cash shift drawer balance"
              >
                <Wallet className="w-3.5 h-3.5" />
                <span className="font-mono tabular-nums">
                  {activeCashSession
                    ? formatMoney(activeCashSession.expectedClosingBalanceMinor, sym)
                    : 'No Shift'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setWedgeEnabled((prev) => !prev)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap ${
                  wedgeEnabled
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-slate-50 border-slate-200 text-slate-500'
                }`}
                title="Capture rapid input bursts from USB/Bluetooth hardware barcode scanners anywhere on this page"
              >
                <Zap className="w-3 h-3" />
                Auto-Scan {wedgeEnabled ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                onClick={() => setSoundEnabled((prev) => !prev)}
                className={`p-1.5 rounded-lg border transition-colors ${
                  soundEnabled
                    ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    : 'bg-slate-50 border-slate-200 text-slate-400'
                }`}
                title={soundEnabled ? 'Mute scanner beep' : 'Enable scanner beep'}
              >
                {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <form onSubmit={handleBarcodeSubmit} className="lg:col-span-7 flex items-center gap-2">
              <div className="relative flex-1">
                <Barcode className="w-4 h-4 text-emerald-600 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  ref={barcodeInputRef}
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder="Scan barcode, SKU, or 3*barcode..."
                  autoComplete="off"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg font-mono focus:outline-none focus:border-emerald-600"
                />
              </div>
              <button
                type="submit"
                className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Scan Add
              </button>
              <button
                type="button"
                onClick={() => setShowCameraScanner(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                title="Scan EAN, UPC, or SKU barcodes with device camera"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Camera Scan</span>
              </button>
            </form>
            <div className="lg:col-span-5 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter catalog by name, SKU, barcode..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          {lastScan && (
            <div
              className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                lastScan.status === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {lastScan.status === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span className="font-mono font-semibold shrink-0">[{lastScan.code}]</span>
                <span className="truncate">{lastScan.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setLastScan(null)}
                className="text-slate-400 hover:text-slate-700 shrink-0"
                aria-label="Dismiss scan message"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                selectedCategory === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All Categories
            </button>
            {categories
              .filter((c) => c.status === 'active')
              .map((c) => (
                <button
                  key={c.categoryId}
                  type="button"
                  onClick={() => setSelectedCategory(c.categoryId)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    selectedCategory === c.categoryId
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {c.name}
                </button>
              ))}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {branchProducts.map((p) => {
            const inv = inventoryByProduct.get(p.productId);
            const qty = inv?.quantityAvailable ?? 0;
            const price = inv?.sellingPriceMinor ?? p.sellingPriceMinor;
            const outOfStock = !inv || (!allowNegative && qty <= 0);
            return (
              <button
                key={p.productId}
                type="button"
                disabled={outOfStock}
                onClick={() => addProductToCart(p)}
                className="text-left bg-white border border-slate-200 rounded-xl p-3 hover:border-emerald-600 transition-colors flex flex-col justify-between disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div>
                  <div className="aspect-[4/3] w-full rounded-lg bg-slate-100 overflow-hidden mb-2.5 flex items-center justify-center">
                    {(() => {
                      const safeImg = sanitizeHttpUrl(p.imageUrl);
                      return safeImg ? (
                        <img
                          src={safeImg}
                          alt={p.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Package className="w-7 h-7 text-slate-400" />
                      );
                    })()}
                  </div>
                  <p className="text-sm font-semibold text-slate-900 line-clamp-2 leading-snug">
                    {p.name}
                  </p>
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">
                    {p.sku}
                    {p.barcode ? ` · ${p.barcode}` : ''}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold font-mono tabular-nums text-emerald-700">
                    {formatMoney(price, sym)}
                  </span>
                  <span
                    className={`text-[11px] font-mono tabular-nums ${
                      qty <= (inv?.reorderLevel ?? p.minimumStock)
                        ? 'text-rose-600 font-semibold'
                        : 'text-slate-500'
                    }`}
                  >
                    {inv ? `${qty} ${p.unit || 'pcs'}` : 'Unstocked'}
                  </span>
                </div>
              </button>
            );
          })}
          {branchProducts.length === 0 && (
            <div className="col-span-full bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
              No active products match your search or branch availability.
            </div>
          )}
        </div>
      </div>

      {/* Right: Shopping Cart & Totals */}
      <div className="xl:col-span-4 bg-white border border-slate-200 rounded-xl flex flex-col sticky top-20">
        <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Current Sale Cart
              {cart.length > 0 && (
                <span className="ml-1.5 text-xs font-mono text-slate-500">
                  ({cart.reduce((s, c) => s + c.quantity, 0)})
                </span>
              )}
            </h2>
          </div>
          {cart.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowHoldModal(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-800 whitespace-nowrap"
                title="Park this order to resume later (F8)"
              >
                <PauseCircle className="w-3.5 h-3.5" />
                Hold
              </button>
              <button
                type="button"
                onClick={() => {
                  setCart([]);
                  setOrderDiscountInput('0');
                  setOrderNote('');
                }}
                className="text-xs text-rose-600 hover:underline whitespace-nowrap"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Customer Selection */}
        <div className="px-4 py-3 border-b border-slate-100 space-y-2">
          <div className="flex items-center gap-2">
            <select
              aria-label="Select Customer"
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            >
              <option value="">Walk-in Customer (Anonymous)</option>
              {customers.map((c) => (
                <option key={c.customerId} value={c.customerId}>
                  {c.fullName} {c.phone ? `(${c.phone})` : ''}
                </option>
              ))}
            </select>
            {hasPermission('customers.create') && (
              <button
                type="button"
                onClick={() => setShowNewCustomer(true)}
                className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                title="Register New Customer"
              >
                <UserPlus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {selectedCustomer && (
            <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">
              <span>
                {selectedCustomer.phone || 'No phone'} ·{' '}
                <span className="font-mono tabular-nums">{selectedCustomer.transactionCount}</span> visits
              </span>
              <span className="font-mono tabular-nums font-medium text-emerald-700">
                Lifetime: {formatMoney(selectedCustomer.totalPurchasesMinor, sym)}
              </span>
            </div>
          )}
        </div>

        {/* Cart Items */}
        <div className="p-4 space-y-3 max-h-[380px] overflow-y-auto divide-y divide-slate-100">
          {cart.map((line) => {
            const lineCalc = calculateLineAmounts(
              {
                unitPriceMinor: line.unitPriceMinor,
                costPriceMinor: line.costPriceMinor,
                quantity: line.quantity,
                discountMinor: line.discountMinor,
                taxCategory: line.product.taxCategory,
              },
              defaultTaxRateBps,
              taxIncludedInPrice
            );
            const isHighlighted = highlightedProductId === line.product.productId;
            return (
              <div
                key={line.product.productId}
                className={`pt-3 first:pt-0 space-y-2 transition-colors rounded-lg ${
                  isHighlighted ? 'bg-emerald-50/90 px-2 py-2 -mx-2' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">
                      {line.product.name}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500">
                      {formatMoney(line.unitPriceMinor, sym)} each
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setCart((prev) =>
                        prev.filter((x) => x.product.productId !== line.product.productId)
                      )
                    }
                    className="text-slate-400 hover:text-rose-600 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => updateCartQty(line.product.productId, -1)}
                      className="p-1.5 text-slate-600 hover:bg-slate-50"
                      aria-label={`Decrease quantity for ${line.product.name}`}
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      aria-label={`Quantity for ${line.product.name}`}
                      value={line.quantity}
                      onChange={(e) => setCartLineQty(line.product.productId, e.target.value)}
                      className="w-11 text-center text-xs font-mono tabular-nums font-semibold py-1 border-x border-slate-200 focus:outline-none focus:bg-emerald-50"
                    />
                    <button
                      type="button"
                      onClick={() => updateCartQty(line.product.productId, 1)}
                      className="p-1.5 text-slate-600 hover:bg-slate-50"
                      aria-label={`Increase quantity for ${line.product.name}`}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {canApplyDiscounts && (
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-slate-400">Disc:</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={fromMinorUnits(line.discountMinor) || ''}
                        onChange={(e) =>
                          updateLineDiscount(line.product.productId, e.target.value)
                        }
                        placeholder="0.00"
                        className="w-16 px-1.5 py-1 text-right text-xs font-mono border border-slate-200 rounded"
                      />
                    </div>
                  )}

                  <span className="text-xs font-bold font-mono tabular-nums text-slate-900">
                    {formatMoney(lineCalc.lineTotalMinor, sym)}
                  </span>
                </div>
              </div>
            );
          })}

          {cart.length === 0 && (
            <div className="py-10 text-center text-xs text-slate-400">
              Scan a barcode or tap products to add them to the cart.
            </div>
          )}
        </div>

        {/* Totals & Checkout */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/70 rounded-b-xl space-y-2.5">
          {cart.length > 0 && (
            <input
              type="text"
              value={orderNote}
              onChange={(e) => setOrderNote(e.target.value)}
              placeholder="Optional order note (e.g. packaging / hold ref)..."
              maxLength={120}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            />
          )}

          {canApplyDiscounts && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="text-slate-600 flex items-center gap-1">
                  <Percent className="w-3 h-3 text-slate-400" />
                  Order Discount ({sym})
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={orderDiscountInput}
                  onChange={(e) => setOrderDiscountInput(e.target.value)}
                  className="w-24 px-2 py-1 text-right font-mono bg-white border border-slate-200 rounded"
                />
              </div>
              {cart.length > 0 && maxDiscountPct > 0 && (
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[10px] text-slate-400">
                    Max {maxDiscountPct}% ({formatMoney(maxOrderDiscountMinor, sym)})
                  </span>
                  <div className="flex items-center gap-1">
                    {[0, 5, 10]
                      .filter((pct) => pct <= maxDiscountPct)
                      .map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => applyOrderDiscountPct(pct)}
                          className="px-2 py-0.5 text-[10px] font-mono font-medium rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
                        >
                          {pct === 0 ? 'Clear' : `${pct}%`}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-between text-xs text-slate-600">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums">{formatMoney(totals.subtotalMinor, sym)}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-600">
            <span>Discounts</span>
            <span className="font-mono tabular-nums">-{formatMoney(totals.discountMinor, sym)}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-600">
            <span>
              Tax ({organization?.taxLabel || 'VAT'}
              {taxIncludedInPrice ? ' · Incl. in price' : ''})
            </span>
            <span className="font-mono tabular-nums">
              {formatTaxDisplayValue({
                taxMinor: totals.taxMinor,
                currencySymbol: sym,
                defaultTaxRateBps,
                taxDisplayMode: systemSettings?.taxDisplayMode,
              })}
            </span>
          </div>
          <div className="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-slate-200">
            <span>Grand Total</span>
            <span className="font-mono tabular-nums text-emerald-700">
              {formatMoney(totals.totalMinor, sym)}
            </span>
          </div>

          {entitlements && !entitlements.isOperational && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
              {entitlements.blockingReason || 'Subscription is inactive. Renew in Plan & Billing to process sales.'}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHoldModal(true)}
                className="py-3 px-3.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                title="Park current order (F8)"
              >
                <PauseCircle className="w-4 h-4 text-amber-600" />
                Hold
              </button>
            )}
            <button
              type="button"
              disabled={cart.length === 0 || (entitlements ? !entitlements.isOperational : false)}
              onClick={openPaymentModal}
              className="flex-1 py-3 px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap"
            >
              <CreditCard className="w-4 h-4" />
              Proceed to Payment
            </button>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Payment Confirmation
              </h3>
              <button
                type="button"
                onClick={() => setShowPayment(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">Total Amount Due</span>
              <span className="text-xl font-bold font-mono tabular-nums text-slate-900">
                {formatMoney(totals.totalMinor, sym)}
              </span>
            </div>

            {quickCashSuggestionsMinor.length > 0 && (
              <div className="space-y-1.5">
                <span className="block text-[11px] font-medium text-slate-500">
                  Quick Cash Tender (fills active payment row)
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {quickCashSuggestionsMinor.map((amtMinor, idx) => (
                    <button
                      key={amtMinor}
                      type="button"
                      onClick={() => applyQuickTenderAmount(amtMinor)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-300 text-xs font-mono tabular-nums font-medium text-slate-800 whitespace-nowrap"
                    >
                      {idx === 0 ? `Exact (${formatMoney(amtMinor, sym)})` : formatMoney(amtMinor, sym)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {splitPayments.map((sp, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <select
                    value={sp.method}
                    onChange={(e) => {
                      const val = e.target.value as SinglePaymentMethod;
                      setActiveSplitIdx(idx);
                      setSplitPayments((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, method: val } : row))
                      );
                    }}
                    className="col-span-4 px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    {supportedMethods.map((m) => (
                      <option key={m} value={m}>
                        {m.replace('_', ' ').toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={sp.amountStr}
                    onFocus={() => setActiveSplitIdx(idx)}
                    onChange={(e) =>
                      setSplitPayments((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, amountStr: e.target.value } : row
                        )
                      )
                    }
                    placeholder="Amount"
                    className="col-span-4 px-2.5 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                  <input
                    type="text"
                    value={sp.reference}
                    onFocus={() => setActiveSplitIdx(idx)}
                    onChange={(e) =>
                      setSplitPayments((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, reference: e.target.value } : row
                        )
                      )
                    }
                    placeholder="Ref / Txn ID"
                    className="col-span-3 px-2.5 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                  {splitPayments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSplitPayments((prev) => prev.filter((_, i) => i !== idx));
                        setActiveSplitIdx(0);
                      }}
                      className="col-span-1 text-slate-400 hover:text-rose-600 flex justify-center"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const nextIdx = splitPayments.length;
                    setSplitPayments((prev) => [
                      ...prev,
                      {
                        method: supportedMethods.find((m) => m !== 'cash') || 'mobile_money',
                        amountStr:
                          remainingDueMinor > 0
                            ? fromMinorUnits(remainingDueMinor).toFixed(2)
                            : '0',
                        reference: '',
                      },
                    ]);
                    setActiveSplitIdx(nextIdx);
                  }}
                  className="text-xs font-medium text-emerald-700 hover:underline"
                >
                  + Add Split Payment Method
                </button>
                {remainingDueMinor > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const currentRowMinor = Math.max(
                        0,
                        toMinorUnits(splitPayments[activeSplitIdx]?.amountStr || '0')
                      );
                      applyQuickTenderAmount(currentRowMinor + remainingDueMinor);
                    }}
                    className="text-[11px] font-medium text-amber-700 hover:underline"
                  >
                    Fill remaining ({formatMoney(remainingDueMinor, sym)})
                  </button>
                )}
              </div>
            </div>

            {splitPayments.some((p) => p.method !== 'cash') && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                Notice: External Mobile Money / Card / Bank Transfer payment gateway APIs are not
                yet integrated. Confirm receipt manually on your terminal before completing.
              </p>
            )}

            <div className="space-y-1.5 text-xs pt-2 border-t border-slate-200">
              {remainingDueMinor > 0 && (
                <div className="flex items-center justify-between text-rose-700 font-medium">
                  <span>Remaining Balance Due:</span>
                  <span className="font-mono font-bold tabular-nums">
                    {formatMoney(remainingDueMinor, sym)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Change Due to Customer:</span>
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  {formatMoney(Math.max(0, totalTenderedMinor - totals.totalMinor), sym)}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowPayment(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={processingSale || totalTenderedMinor < totals.totalMinor}
                onClick={() => void handleCompleteSale()}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                {processingSale ? 'Completing Sale...' : 'Confirm & Print Receipt'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Customer Modal */}
      {showNewCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={(e) => void handleQuickCreateCustomer(e)}
            className="bg-white border border-slate-200 rounded-xl max-w-sm w-full p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold text-slate-900">Quick Register Customer</h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                value={newCustPhone}
                onChange={(e) => setNewCustPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewCustomer(false)}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg"
              >
                Save Customer
              </button>
            </div>
          </form>
        </div>
      )}

      <HoldOrderModal
        open={showHoldModal}
        onClose={() => {
          setShowHoldModal(false);
          window.setTimeout(() => barcodeInputRef.current?.focus(), 50);
        }}
        onConfirm={handleParkOrder}
        itemCount={cart.reduce((s, c) => s + c.quantity, 0)}
        totalMinor={totals.totalMinor}
        currencySymbol={sym}
        defaultLabel={
          selectedCustomer
            ? selectedCustomer.fullName
            : `HOLD-${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
        }
        defaultNote={orderNote}
      />

      <HeldOrdersModal
        open={showHeldOrders}
        onClose={() => {
          setShowHeldOrders(false);
          window.setTimeout(() => barcodeInputRef.current?.focus(), 50);
        }}
        heldOrders={heldOrders}
        hasActiveCart={cart.length > 0}
        currencySymbol={sym}
        onResume={handleResumeHeldOrder}
        onDiscard={(holdId) => {
          persistHeldOrders(heldOrders.filter((h) => h.holdId !== holdId));
          notify('info', 'Held Order Discarded', 'Removed parked order from queue.');
        }}
        onClearAll={() => {
          persistHeldOrders([]);
          notify('info', 'Held Orders Cleared', 'All parked orders at this branch were removed.');
        }}
      />

      <RecentReceiptsModal
        open={showRecentReceipts}
        onClose={() => {
          setShowRecentReceipts(false);
          window.setTimeout(() => barcodeInputRef.current?.focus(), 50);
        }}
        sales={branchSales}
        currencySymbol={sym}
        loadingSaleId={loadingReprintId}
        onSelectSale={(sale) => void handleOpenRecentReceipt(sale)}
      />

      <ShiftDrawerModal
        open={showShiftDrawer}
        onClose={() => {
          setShowShiftDrawer(false);
          window.setTimeout(() => barcodeInputRef.current?.focus(), 50);
        }}
        session={activeCashSession}
        branchName={activeBranch?.branchName || 'Current Branch'}
        currencySymbol={sym}
      />

      <BarcodeScannerModal
        open={showCameraScanner}
        onClose={() => {
          setShowCameraScanner(false);
          window.setTimeout(() => barcodeInputRef.current?.focus(), 50);
        }}
        onDetected={processScannedCode}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled((prev) => !prev)}
        lastScan={lastScan}
        cartItemCount={cart.reduce((sum, line) => sum + line.quantity, 0)}
      />

      <ReceiptModal
        open={Boolean(receiptSale)}
        onClose={() => {
          setReceiptSale(null);
          window.setTimeout(() => barcodeInputRef.current?.focus(), 50);
        }}
        organization={organization}
        branch={activeBranch}
        settings={systemSettings}
        sale={receiptSale}
        items={receiptItems}
      />
    </div>
  );
}
