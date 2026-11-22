import type { ReceiptFieldKey, SystemSettings } from '../types/pos';

export interface ReceiptFieldOption {
  key: ReceiptFieldKey;
  label: string;
  description: string;
}

export const RECEIPT_FIELD_OPTIONS: ReceiptFieldOption[] = [
  {
    key: 'logo',
    label: 'Business Logo',
    description: 'Organization logo image at the top of the receipt',
  },
  {
    key: 'branchInfo',
    label: 'Branch Details',
    description: 'Branch name, code, street address, and phone number',
  },
  {
    key: 'receiptHeader',
    label: 'Receipt Header Note',
    description: 'Custom header line configured below',
  },
  {
    key: 'date',
    label: 'Date & Time',
    description: 'Transaction timestamp on the receipt',
  },
  {
    key: 'cashier',
    label: 'Cashier Name',
    description: 'Staff member who processed the sale',
  },
  {
    key: 'customer',
    label: 'Customer Name',
    description: 'Attached customer or Walk-in Customer label',
  },
  {
    key: 'itemSku',
    label: 'Product SKU',
    description: 'Show item SKU code beneath each purchased line item',
  },
  {
    key: 'itemBreakdown',
    label: 'Quantity × Unit Price & Line Discount',
    description: 'Per-item quantity, unit price, and line discount details',
  },
  {
    key: 'discount',
    label: 'Discount Summary Line',
    description: 'Order-level and total discount summary row',
  },
  {
    key: 'tax',
    label: 'Tax Breakdown',
    description: 'Tax label and calculated tax amount row',
  },
  {
    key: 'paymentMethod',
    label: 'Payment, Tendered & Change',
    description: 'Payment method, amount received, and change given',
  },
  {
    key: 'returnPolicy',
    label: 'Return & Refund Policy',
    description: 'Configured return policy text at the bottom of the receipt',
  },
  {
    key: 'receiptFooter',
    label: 'Receipt Footer Note',
    description: 'Closing thank-you message at the bottom of the receipt',
  },
];

export const DEFAULT_RECEIPT_VISIBLE_FIELDS: ReceiptFieldKey[] = [
  'logo',
  'branchInfo',
  'receiptHeader',
  'date',
  'cashier',
  'customer',
  'itemBreakdown',
  'discount',
  'tax',
  'paymentMethod',
  'returnPolicy',
  'receiptFooter',
];

export interface ResolvedReceiptFields {
  logo: boolean;
  branchInfo: boolean;
  receiptHeader: boolean;
  date: boolean;
  cashier: boolean;
  customer: boolean;
  itemSku: boolean;
  itemBreakdown: boolean;
  discount: boolean;
  tax: boolean;
  paymentMethod: boolean;
  returnPolicy: boolean;
  receiptFooter: boolean;
}

export function resolveReceiptFields(settings?: SystemSettings | null): ResolvedReceiptFields {
  const active = new Set<ReceiptFieldKey>(
    settings?.receiptVisibleFields ?? DEFAULT_RECEIPT_VISIBLE_FIELDS
  );

  return {
    logo: active.has('logo'),
    branchInfo: active.has('branchInfo'),
    receiptHeader: active.has('receiptHeader'),
    date: active.has('date'),
    cashier: active.has('cashier'),
    customer: active.has('customer'),
    itemSku: active.has('itemSku'),
    itemBreakdown: active.has('itemBreakdown'),
    discount: active.has('discount'),
    tax: active.has('tax'),
    paymentMethod: active.has('paymentMethod'),
    returnPolicy: active.has('returnPolicy'),
    receiptFooter: active.has('receiptFooter'),
  };
}
