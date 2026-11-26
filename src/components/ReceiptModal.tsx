import { useState } from 'react';
import { Download, Printer, X } from 'lucide-react';
import { formatDateTime, formatMoney, formatTaxDisplayValue } from '../lib/money';
import { resolveReceiptFields } from '../lib/receiptConfig';
import { sanitizeImageSrc } from '../lib/url';
import { downloadReceiptPdf } from '../services/posService';
import type { Branch, Organization, Sale, SaleItem, SystemSettings } from '../types/pos';
import { PrintOptionsModal } from './PrintOptionsModal';

interface ReceiptModalProps {
  open: boolean;
  onClose: () => void;
  organization: Organization | null;
  branch: Branch | null;
  settings: SystemSettings | null;
  sale: Sale | null;
  items: SaleItem[];
}

export function ReceiptModal({
  open,
  onClose,
  organization,
  branch,
  settings,
  sale,
  items,
}: ReceiptModalProps) {
  const [printOpen, setPrintOpen] = useState(false);

  if (!open || !sale || !organization) return null;
  const sym = organization.currencySymbol || 'GH₵';
  const rf = resolveReceiptFields(settings);

  return (
    <>
      <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
        <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full max-h-[92vh] flex flex-col shadow-xl">
          <div className="no-print flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Official Retail Receipt
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadReceiptPdf({ organization, branch, settings, sale, items })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                PDF
              </button>
              <button
                type="button"
                onClick={() => setPrintOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-700 whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" />
                Print
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded"
                aria-label="Close receipt"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

        <div className="p-6 overflow-y-auto font-mono text-xs text-slate-800 space-y-4">
          <div className="text-center space-y-1 border-b border-dashed border-slate-300 pb-4">
            {rf.logo && sanitizeImageSrc(organization.logoUrl) && (
              <img
                src={sanitizeImageSrc(organization.logoUrl)!}
                alt={organization.businessName}
                referrerPolicy="no-referrer"
                className="h-10 mx-auto object-contain mb-2"
              />
            )}
            <p className="text-sm font-bold text-slate-900 uppercase">
              {organization.businessName}
            </p>
            {rf.branchInfo && branch && (
              <>
                <p className="font-medium text-slate-700">
                  {branch.branchName} ({branch.branchCode})
                </p>
                {branch.address && <p className="text-slate-500">{branch.address}</p>}
                {branch.contactNumber && (
                  <p className="text-slate-500">Tel: {branch.contactNumber}</p>
                )}
              </>
            )}
            {rf.receiptHeader && settings?.receiptHeader && (
              <p className="text-[11px] text-slate-500 pt-1">{settings.receiptHeader}</p>
            )}
          </div>

          <div className="space-y-1 border-b border-dashed border-slate-300 pb-3">
            <div className="flex justify-between">
              <span className="text-slate-500">Receipt No:</span>
              <span className="font-semibold text-slate-900">{sale.transactionNumber}</span>
            </div>
            {rf.date && (
              <div className="flex justify-between">
                <span className="text-slate-500">Date:</span>
                <span>{formatDateTime(sale.createdAt)}</span>
              </div>
            )}
            {rf.cashier && (
              <div className="flex justify-between">
                <span className="text-slate-500">Cashier:</span>
                <span>{sale.cashierName || 'Staff'}</span>
              </div>
            )}
            {rf.customer && (
              <div className="flex justify-between">
                <span className="text-slate-500">Customer:</span>
                <span>{sale.customerName || 'Walk-in Customer'}</span>
              </div>
            )}
          </div>

          <div className="space-y-2 border-b border-dashed border-slate-300 pb-3">
            <div className="flex justify-between font-semibold text-slate-600">
              <span>Item</span>
              <span>Amount</span>
            </div>
            {items.map((item) => (
              <div key={item.itemId} className="space-y-0.5">
                <div className="flex justify-between text-slate-900">
                  <span className="font-medium">{item.productName}</span>
                  <span className="tabular-nums font-semibold">
                    {formatMoney(item.lineTotalMinor, sym)}
                  </span>
                </div>
                {(rf.itemBreakdown || (rf.itemSku && item.sku)) && (
                  <div className="text-[11px] text-slate-500 flex justify-between gap-2">
                    <span>
                      {rf.itemBreakdown
                        ? `${item.quantity} × ${formatMoney(item.unitPriceMinor, sym)}`
                        : ''}
                      {rf.itemSku && item.sku
                        ? `${rf.itemBreakdown ? ' · ' : ''}SKU: ${item.sku}`
                        : ''}
                    </span>
                    {rf.itemBreakdown && item.discountMinor > 0 && (
                      <span>Disc: -{formatMoney(item.discountMinor, sym)}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-1.5 border-b border-dashed border-slate-300 pb-3">
            <div className="flex justify-between">
              <span className="text-slate-500">Subtotal</span>
              <span className="tabular-nums">{formatMoney(sale.subtotalMinor, sym)}</span>
            </div>
            {rf.discount && (
              <div className="flex justify-between">
                <span className="text-slate-500">Discount</span>
                <span className="tabular-nums">-{formatMoney(sale.discountMinor, sym)}</span>
              </div>
            )}
            {rf.tax && (
              <div className="flex justify-between">
                <span className="text-slate-500">
                  Tax ({organization.taxLabel || 'VAT'}
                  {settings?.taxIncludedInPrice ? ' Incl.' : ''})
                </span>
                <span className="tabular-nums">
                  {formatTaxDisplayValue({
                    taxMinor: sale.taxMinor,
                    currencySymbol: sym,
                    defaultTaxRateBps: organization.defaultTaxRateBps,
                    taxDisplayMode: settings?.taxDisplayMode,
                  })}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-slate-900 pt-1">
              <span>GRAND TOTAL</span>
              <span className="tabular-nums">{formatMoney(sale.totalMinor, sym)}</span>
            </div>
          </div>

          {rf.paymentMethod && (
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Method</span>
                <span className="uppercase font-medium">
                  {sale.paymentMethod.replace('_', ' ')}
                </span>
              </div>
              {sale.amountTenderedMinor !== undefined && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Amount Received</span>
                  <span className="tabular-nums">
                    {formatMoney(sale.amountTenderedMinor, sym)}
                  </span>
                </div>
              )}
              {sale.changeMinor !== undefined && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Change Given</span>
                  <span className="tabular-nums">{formatMoney(sale.changeMinor, sym)}</span>
                </div>
              )}
            </div>
          )}

          {((rf.returnPolicy && settings?.returnPolicy) ||
            (rf.receiptFooter && settings?.receiptFooter)) && (
            <div className="text-center text-[11px] text-slate-500 pt-3 border-t border-dashed border-slate-300 space-y-1.5">
              {rf.returnPolicy && settings?.returnPolicy && <p>{settings.returnPolicy}</p>}
              {rf.receiptFooter && settings?.receiptFooter && (
                <p className="font-medium text-slate-700">{settings.receiptFooter}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>

      <PrintOptionsModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        document={{
          kind: 'receipt',
          title: `Receipt ${sale.transactionNumber}`,
          organizationName: organization.businessName,
          branchLabel: branch ? `${branch.branchName} (${branch.branchCode})` : undefined,
          receiptData: {
            organization,
            branch,
            settings,
            sale,
            items,
          },
        }}
      />
    </>
  );
}
