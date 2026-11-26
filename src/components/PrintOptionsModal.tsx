import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ExternalLink, Printer, X } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime, formatMoney, formatTaxDisplayValue } from '../lib/money';
import { resolveReceiptFields } from '../lib/receiptConfig';
import { sanitizeImageSrc } from '../lib/url';
import type { Branch, Organization, Sale, SaleItem, SystemSettings } from '../types/pos';
import {
  BarcodeLabelsSheet,
  type BarcodeLabelConfig,
  type BarcodeLabelItem,
} from './BarcodeLabelSheet';

export type PrintPaperPreset =
  | 'thermal_80'
  | 'thermal_58'
  | 'a4_portrait'
  | 'a4_landscape'
  | 'letter_portrait'
  | 'letter_landscape';

export interface PrintDocumentPayload {
  kind: 'receipt' | 'report' | 'purchase_order' | 'barcode_labels';
  title: string;
  subtitle?: string;
  organizationName: string;
  branchLabel?: string;
  summaryItems?: Array<{ label: string; value: string }>;
  receiptData?: {
    organization: Organization;
    branch: Branch | null;
    settings: SystemSettings | null;
    sale: Sale;
    items: SaleItem[];
  };
  tableData?: {
    filename: string;
    headers: string[];
    rows: Array<Array<string | number>>;
    footerNote?: string;
  };
  barcodeData?: {
    organization: Organization | null;
    items: BarcodeLabelItem[];
    config: BarcodeLabelConfig;
  };
}

interface PrintOptionsModalProps {
  open: boolean;
  onClose: () => void;
  document: PrintDocumentPayload | null;
}

const PAPER_OPTIONS_BY_KIND: Record<
  PrintDocumentPayload['kind'],
  Array<{ value: PrintPaperPreset; label: string; pageCss: string }>
> = {
  receipt: [
    { value: 'thermal_80', label: 'Thermal 80mm Roll', pageCss: '80mm auto' },
    { value: 'thermal_58', label: 'Thermal 58mm Roll', pageCss: '58mm auto' },
    { value: 'a4_portrait', label: 'A4 Sheet (Portrait)', pageCss: 'A4 portrait' },
  ],
  report: [
    { value: 'a4_portrait', label: 'A4 Portrait', pageCss: 'A4 portrait' },
    { value: 'a4_landscape', label: 'A4 Landscape', pageCss: 'A4 landscape' },
    { value: 'letter_portrait', label: 'Letter Portrait', pageCss: 'letter portrait' },
    { value: 'letter_landscape', label: 'Letter Landscape', pageCss: 'letter landscape' },
  ],
  purchase_order: [
    { value: 'a4_portrait', label: 'A4 Portrait', pageCss: 'A4 portrait' },
    { value: 'a4_landscape', label: 'A4 Landscape', pageCss: 'A4 landscape' },
    { value: 'letter_portrait', label: 'Letter Portrait', pageCss: 'letter portrait' },
    { value: 'letter_landscape', label: 'Letter Landscape', pageCss: 'letter landscape' },
  ],
  barcode_labels: [
    { value: 'a4_portrait', label: 'A4 Label Sheet (Portrait)', pageCss: 'A4 portrait' },
    { value: 'thermal_58', label: 'Thermal Sticker Roll (58mm)', pageCss: '58mm auto' },
    { value: 'letter_portrait', label: 'Letter Label Sheet (Portrait)', pageCss: 'letter portrait' },
  ],
};

function ReceiptSheet({
  data,
  paperPreset,
  monochrome,
}: {
  data: NonNullable<PrintDocumentPayload['receiptData']>;
  paperPreset: PrintPaperPreset;
  monochrome: boolean;
}) {
  const { organization, branch, settings, sale, items } = data;
  const sym = organization.currencySymbol || 'GH₵';
  const rf = resolveReceiptFields(settings);
  const widthClass =
    paperPreset === 'thermal_58'
      ? 'max-w-[58mm] text-[10px]'
      : paperPreset === 'thermal_80'
        ? 'max-w-[80mm] text-[11px]'
        : 'max-w-[680px] text-xs';

  return (
    <div
      className={`mx-auto bg-white font-mono p-4 ${widthClass} ${
        monochrome ? 'text-black grayscale' : 'text-slate-800'
      }`}
    >
      <div className="text-center space-y-1 border-b border-dashed border-slate-400 pb-3">
        {rf.logo && sanitizeImageSrc(organization.logoUrl) && (
          <img
            src={sanitizeImageSrc(organization.logoUrl)!}
            alt={organization.businessName}
            referrerPolicy="no-referrer"
            className="h-9 mx-auto object-contain mb-1.5"
          />
        )}
        <p className="text-sm font-bold text-slate-950 uppercase">{organization.businessName}</p>
        {rf.branchInfo && branch && (
          <>
            <p className="font-semibold">
              {branch.branchName} ({branch.branchCode})
            </p>
            {branch.address && <p className="text-slate-600">{branch.address}</p>}
            {branch.contactNumber && <p className="text-slate-600">Tel: {branch.contactNumber}</p>}
          </>
        )}
        {rf.receiptHeader && settings?.receiptHeader && (
          <p className="pt-1 text-slate-600">{settings.receiptHeader}</p>
        )}
      </div>

      <div className="space-y-1 border-b border-dashed border-slate-400 py-2.5">
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Receipt No:</span>
          <span className="font-bold text-slate-950">{sale.transactionNumber}</span>
        </div>
        {rf.date && (
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Date:</span>
            <span>{formatDateTime(sale.createdAt)}</span>
          </div>
        )}
        {rf.cashier && (
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Cashier:</span>
            <span>{sale.cashierName || 'Staff'}</span>
          </div>
        )}
        {rf.customer && (
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Customer:</span>
            <span>{sale.customerName || 'Walk-in Customer'}</span>
          </div>
        )}
      </div>

      <div className="space-y-2 border-b border-dashed border-slate-400 py-2.5">
        <div className="flex justify-between font-bold text-slate-700">
          <span>Item</span>
          <span>Amount</span>
        </div>
        {items.map((item) => (
          <div key={item.itemId} className="space-y-0.5">
            <div className="flex justify-between gap-2 text-slate-950">
              <span className="font-medium">{item.productName}</span>
              <span className="tabular-nums font-semibold shrink-0">
                {formatMoney(item.lineTotalMinor, sym)}
              </span>
            </div>
            {(rf.itemBreakdown || (rf.itemSku && item.sku)) && (
              <div className="text-[10px] text-slate-600 flex justify-between gap-2">
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

      <div className="space-y-1 border-b border-dashed border-slate-400 py-2.5">
        <div className="flex justify-between">
          <span className="text-slate-600">Subtotal</span>
          <span className="tabular-nums">{formatMoney(sale.subtotalMinor, sym)}</span>
        </div>
        {rf.discount && (
          <div className="flex justify-between">
            <span className="text-slate-600">Discount</span>
            <span className="tabular-nums">-{formatMoney(sale.discountMinor, sym)}</span>
          </div>
        )}
        {rf.tax && (
          <div className="flex justify-between">
            <span className="text-slate-600">
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
        <div className="flex justify-between text-sm font-bold text-slate-950 pt-1">
          <span>GRAND TOTAL</span>
          <span className="tabular-nums">{formatMoney(sale.totalMinor, sym)}</span>
        </div>
      </div>

      {rf.paymentMethod && (
        <div className="space-y-1 py-2.5 text-[10px]">
          <div className="flex justify-between">
            <span className="text-slate-600">Payment Method</span>
            <span className="uppercase font-semibold">{sale.paymentMethod.replace('_', ' ')}</span>
          </div>
          {sale.amountTenderedMinor !== undefined && (
            <div className="flex justify-between">
              <span className="text-slate-600">Amount Received</span>
              <span className="tabular-nums">{formatMoney(sale.amountTenderedMinor, sym)}</span>
            </div>
          )}
          {sale.changeMinor !== undefined && (
            <div className="flex justify-between">
              <span className="text-slate-600">Change Given</span>
              <span className="tabular-nums">{formatMoney(sale.changeMinor, sym)}</span>
            </div>
          )}
        </div>
      )}

      {((rf.returnPolicy && settings?.returnPolicy) ||
        (rf.receiptFooter && settings?.receiptFooter)) && (
        <div className="text-center text-[10px] text-slate-600 pt-2.5 border-t border-dashed border-slate-400 space-y-1">
          {rf.returnPolicy && settings?.returnPolicy && <p>{settings.returnPolicy}</p>}
          {rf.receiptFooter && settings?.receiptFooter && (
            <p className="font-semibold text-slate-800">{settings.receiptFooter}</p>
          )}
        </div>
      )}
    </div>
  );
}

function TabularDocumentSheet({
  doc,
  monochrome,
}: {
  doc: PrintDocumentPayload;
  monochrome: boolean;
}) {
  const headers = doc.tableData?.headers || [];
  const rows = doc.tableData?.rows || [];

  return (
    <div
      className={`mx-auto bg-white p-6 text-xs ${
        monochrome ? 'text-black grayscale' : 'text-slate-900'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-300 pb-3 mb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            {doc.organizationName}
          </p>
          <h3 className="text-base font-bold text-slate-950 mt-0.5">{doc.title}</h3>
          {doc.subtitle && <p className="text-[11px] text-slate-600 mt-0.5">{doc.subtitle}</p>}
        </div>
        <div className="text-right text-[11px] text-slate-500 font-mono">
          {doc.branchLabel && <p>{doc.branchLabel}</p>}
          <p>Printed {new Date().toLocaleString()}</p>
        </div>
      </div>

      {doc.summaryItems && doc.summaryItems.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          {doc.summaryItems.map((item) => (
            <div
              key={item.label}
              className="border border-slate-200 bg-slate-50/70 rounded-lg px-3 py-2"
            >
              <p className="text-[10px] text-slate-500 truncate">{item.label}</p>
              <p className="text-xs font-bold font-mono tabular-nums text-slate-950 mt-0.5">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      )}

      <table className="w-full text-left border-collapse border border-slate-200">
        <thead>
          <tr className="bg-slate-900 text-white text-[11px]">
            {headers.map((h) => (
              <th key={h} className="py-2 px-2.5 font-semibold border-r border-slate-700 last:border-r-0">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 text-[11px]">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, headers.length)} className="py-6 text-center text-slate-500">
                No records available for this document.
              </td>
            </tr>
          ) : (
            rows.map((row, rIdx) => (
              <tr key={rIdx} className={rIdx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                {row.map((cell, cIdx) => (
                  <td
                    key={cIdx}
                    className="py-1.5 px-2.5 border-r border-slate-100 last:border-r-0 font-mono"
                  >
                    {String(cell ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {doc.tableData?.footerNote && (
        <p className="mt-4 pt-3 border-t border-slate-200 text-[11px] text-slate-600">
          {doc.tableData.footerNote}
        </p>
      )}
    </div>
  );
}

export function PrintOptionsModal({ open, onClose, document: doc }: PrintOptionsModalProps) {
  const { notify } = useToast();
  const [paperPreset, setPaperPreset] = useState<PrintPaperPreset>('a4_portrait');
  const [copies, setCopies] = useState(1);
  const [monochrome, setMonochrome] = useState(false);
  const [printBlocked, setPrintBlocked] = useState(false);

  const isEmbeddedIframe = useMemo(() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }, []);

  const paperOptions = useMemo(() => {
    if (!doc) return PAPER_OPTIONS_BY_KIND.report;
    return PAPER_OPTIONS_BY_KIND[doc.kind];
  }, [doc]);

  useEffect(() => {
    if (!open || !doc) return;
    if (doc.kind === 'receipt') {
      setPaperPreset('thermal_80');
      setMonochrome(true);
    } else if (doc.kind === 'barcode_labels') {
      setPaperPreset(
        doc.barcodeData?.config.layout === 'thermal_roll' ? 'thermal_58' : 'a4_portrait'
      );
      setMonochrome(true);
    } else {
      setPaperPreset('a4_portrait');
      setMonochrome(false);
    }
    setCopies(1);
    setPrintBlocked(false);
  }, [open, doc]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        window.document.body.classList.remove('print-sheet-active');
      }
    };
  }, []);

  if (!open || !doc) return null;

  const activePaperOption =
    paperOptions.find((o) => o.value === paperPreset) || paperOptions[0];

  const handleOpenPrinterDialog = () => {
    setPrintBlocked(false);
    const body = window.document.body;
    body.classList.add('print-sheet-active');

    let cleaned = false;
    let beforePrintFired = false;
    const onBeforePrint = () => {
      beforePrintFired = true;
    };
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      body.classList.remove('print-sheet-active');
      window.removeEventListener('afterprint', cleanup);
      window.removeEventListener('beforeprint', onBeforePrint);
    };

    window.addEventListener('beforeprint', onBeforePrint, { once: true });
    window.addEventListener('afterprint', cleanup);
    const safetyTimer = window.setTimeout(cleanup, 60000);

    try {
      const start = performance.now();
      window.print();
      const elapsed = performance.now() - start;

      if (!beforePrintFired && elapsed < 80) {
        window.clearTimeout(safetyTimer);
        cleanup();
        setPrintBlocked(true);
        notify(
          'info',
          'Preview Window Restricted Print Popup',
          'This embedded preview blocks browser print dialogs. Open in a full browser tab to select your printer.'
        );
      }
    } catch (err) {
      window.clearTimeout(safetyTimer);
      cleanup();
      setPrintBlocked(true);
      notify(
        'error',
        'Printer Dialog Blocked',
        err instanceof Error
          ? err.message
          : 'Browser blocked printing in this preview; open the app in a full browser tab.'
      );
    }
  };

  const copyCount = Math.max(1, Math.min(10, Math.round(copies) || 1));

  const renderSingleSheet = () => {
    if (doc.kind === 'receipt' && doc.receiptData) {
      return (
        <ReceiptSheet
          data={doc.receiptData}
          paperPreset={paperPreset}
          monochrome={monochrome}
        />
      );
    }
    if (doc.kind === 'barcode_labels' && doc.barcodeData) {
      return (
        <BarcodeLabelsSheet
          organization={doc.barcodeData.organization}
          items={doc.barcodeData.items}
          config={doc.barcodeData.config}
          monochrome={monochrome}
        />
      );
    }
    return <TabularDocumentSheet doc={doc} monochrome={monochrome} />;
  };

  const printPortal = createPortal(
    <div id="ledgerbranch-print-sheet" className="hidden print:block bg-white text-black">
      <style>{`
        @page {
          size: ${activePaperOption.pageCss};
          margin: ${(doc.kind === 'receipt' && paperPreset !== 'a4_portrait') || (doc.kind === 'barcode_labels' && paperPreset === 'thermal_58') ? '3mm' : '12mm'};
        }
      `}</style>
      {Array.from({ length: copyCount }).map((_, idx) => (
        <div
          key={idx}
          style={idx < copyCount - 1 ? { breakAfter: 'page', pageBreakAfter: 'always' } : undefined}
        >
          {renderSingleSheet()}
        </div>
      ))}
    </div>,
    window.document.body
  );

  return (
    <>
      {printPortal}
      <div
        className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 p-4"
        onClick={onClose}
      >
        <div
          className="bg-white border border-slate-200 rounded-xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <Printer className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 truncate">
                  Print Options — {doc.title}
                </h3>
                <p className="text-[11px] text-slate-500 truncate">
                  Configure paper size, copies, and select a printer in the system print dialog
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              aria-label="Close print options"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body: Options + Live Preview */}
          <div className="grid grid-cols-1 md:grid-cols-5 flex-1 min-h-0 overflow-hidden">
            {/* Left Settings Panel */}
            <div className="md:col-span-2 p-5 border-b md:border-b-0 md:border-r border-slate-200 space-y-4 overflow-y-auto bg-white">
              <div>
                <label
                  htmlFor="print-paper-preset"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Paper Size &amp; Layout
                </label>
                <select
                  id="print-paper-preset"
                  value={paperPreset}
                  onChange={(e) => setPaperPreset(e.target.value as PrintPaperPreset)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-emerald-600"
                >
                  {paperOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="print-copies"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Copies
                  </label>
                  <input
                    id="print-copies"
                    type="number"
                    min={1}
                    max={10}
                    value={copies}
                    onChange={(e) =>
                      setCopies(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono text-slate-900"
                  />
                </div>
                <div className="flex items-end">
                  <label className="w-full flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-700 cursor-pointer select-none hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={monochrome}
                      onChange={(e) => setMonochrome(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>B&amp;W Mode</span>
                  </label>
                </div>
              </div>

              {(printBlocked || isEmbeddedIframe) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-amber-900 leading-relaxed">
                      <p className="font-semibold">
                        {printBlocked
                          ? 'Preview frame blocked the browser print popup'
                          : 'Running inside an embedded preview'}
                      </p>
                      <p className="mt-0.5 text-amber-800">
                        Browser security inside embedded frames can block the OS printer popup. To
                        select your hardware printer, open the app in a full browser tab.
                      </p>
                    </div>
                  </div>
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border border-amber-300 text-[11px] font-semibold text-amber-900 hover:bg-amber-100/60"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open App in Full Browser Tab
                  </a>
                </div>
              )}
            </div>

            {/* Right Live Preview Panel */}
            <div className="md:col-span-3 bg-slate-100 p-4 overflow-y-auto flex flex-col">
              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2">
                <span className="font-medium">Print Preview ({activePaperOption.label})</span>
                {copyCount > 1 && <span className="font-mono">{copyCount} copies</span>}
              </div>
              <div className="flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                {renderSingleSheet()}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-t border-slate-200 bg-slate-50/70">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleOpenPrinterDialog}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              Choose Printer &amp; Print
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
