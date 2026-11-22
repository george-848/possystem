export function toMinorUnits(amount: number | string): number {
  const numeric = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100);
}

export function fromMinorUnits(minor: number): number {
  return (minor || 0) / 100;
}

export function formatMoney(minor: number, currencySymbol = 'GH₵'): string {
  const safeMinor = Number.isFinite(minor) ? minor : 0;
  const isNegative = safeMinor < 0;
  const abs = Math.abs(safeMinor) / 100;
  const formatted = abs.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${isNegative ? '-' : ''}${currencySymbol}${formatted}`;
}

export interface CartCalculationInput {
  unitPriceMinor: number;
  costPriceMinor: number;
  quantity: number;
  discountMinor: number;
  taxCategory: 'standard' | 'exempt' | 'zero';
}

export function calculateLineAmounts(item: CartCalculationInput, defaultTaxRateBps: number) {
  const grossMinor = Math.max(0, Math.round(item.unitPriceMinor * item.quantity));
  const clampedDiscount = Math.min(grossMinor, Math.max(0, Math.round(item.discountMinor)));
  const netBeforeTax = grossMinor - clampedDiscount;
  const rateBps = item.taxCategory === 'standard' ? Math.max(0, defaultTaxRateBps) : 0;
  const taxMinor = Math.round((netBeforeTax * rateBps) / 10000);
  const lineTotalMinor = netBeforeTax + taxMinor;
  const cogsMinor = Math.max(0, Math.round(item.costPriceMinor * item.quantity));
  return {
    grossMinor,
    discountMinor: clampedDiscount,
    netBeforeTax,
    taxMinor,
    lineTotalMinor,
    cogsMinor,
  };
}

export function calculateOrderTotals(
  items: CartCalculationInput[],
  orderDiscountMinor: number,
  defaultTaxRateBps: number
) {
  let subtotalMinor = 0;
  let lineDiscountsMinor = 0;
  let cogsMinor = 0;
  let taxableBaseMinor = 0;

  for (const item of items) {
    const line = calculateLineAmounts(item, defaultTaxRateBps);
    subtotalMinor += line.grossMinor;
    lineDiscountsMinor += line.discountMinor;
    cogsMinor += line.cogsMinor;
    if (item.taxCategory === 'standard') {
      taxableBaseMinor += line.netBeforeTax;
    }
  }

  const afterLineDiscounts = Math.max(0, subtotalMinor - lineDiscountsMinor);
  const safeOrderDiscount = Math.min(afterLineDiscounts, Math.max(0, Math.round(orderDiscountMinor)));
  const discountRatio = afterLineDiscounts > 0 ? (afterLineDiscounts - safeOrderDiscount) / afterLineDiscounts : 1;
  const adjustedTaxableBase = Math.round(taxableBaseMinor * discountRatio);
  const taxMinor = Math.round((adjustedTaxableBase * Math.max(0, defaultTaxRateBps)) / 10000);
  const totalDiscountMinor = lineDiscountsMinor + safeOrderDiscount;
  const totalMinor = Math.max(0, subtotalMinor - totalDiscountMinor + taxMinor);

  return {
    subtotalMinor,
    discountMinor: totalDiscountMinor,
    taxMinor,
    totalMinor,
    cogsMinor,
  };
}

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom';

export function resolveDateRange(
  preset: DatePreset,
  customStart?: string,
  customEnd?: string
): { start: Date; end: Date } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (preset) {
    case 'today':
      return { start: startOfToday, end: endOfToday };
    case 'yesterday': {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 1);
      const e = new Date(endOfToday);
      e.setDate(e.getDate() - 1);
      return { start: s, end: e };
    }
    case 'last7': {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 6);
      return { start: s, end: endOfToday };
    }
    case 'last30': {
      const s = new Date(startOfToday);
      s.setDate(s.getDate() - 29);
      return { start: s, end: endOfToday };
    }
    case 'thisMonth': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start: s, end: endOfToday };
    }
    case 'lastMonth': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start: s, end: e };
    }
    case 'custom': {
      const s = customStart ? new Date(`${customStart}T00:00:00`) : startOfToday;
      const e = customEnd ? new Date(`${customEnd}T23:59:59.999`) : endOfToday;
      return { start: s, end: e };
    }
  }
}

export function timestampToDate(ts: unknown): Date {
  if (!ts) return new Date(0);
  if (ts instanceof Date) return ts;
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate();
  }
  if (typeof ts === 'string' || typeof ts === 'number') {
    return new Date(ts);
  }
  return new Date(0);
}

export function formatDateTime(ts: unknown): string {
  const d = timestampToDate(ts);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return '—';
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
