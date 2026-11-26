import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { jsPDF } from 'jspdf';
import {
  AlertCircle,
  Download,
  ExternalLink,
  FileText,
  Printer,
  X,
} from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useToast } from '../contexts/ToastContext';
import { db } from '../lib/firebase';
import { formatDateTime, formatMoney, formatTaxDisplayValue, timestampToDate } from '../lib/money';
import { sanitizeImageSrc } from '../lib/url';
import type {
  Branch,
  CashSession,
  CashSessionTransaction,
  Organization,
  Refund,
  Sale,
  SystemSettings,
} from '../types/pos';

export type ClosingReportPaperPreset = 'thermal_80' | 'a4_portrait';

interface CashClosingReportModalProps {
  open: boolean;
  onClose: () => void;
  session: CashSession | null;
  organization: Organization | null;
  branch: Branch | null;
  settings?: SystemSettings | null;
  sales: Sale[];
  refunds: Refund[];
}

interface ShiftMetrics {
  transactionCount: number;
  grossSalesMinor: number;
  discountMinor: number;
  taxMinor: number;
  netSalesMinor: number;
  refundCount: number;
  refundTotalMinor: number;
  byMethod: {
    cash: number;
    mobile_money: number;
    card: number;
    bank_transfer: number;
    split: number;
  };
}

function getLogoFormat(src: string | undefined): { isData: boolean; fmt: 'PNG' | 'JPEG' | 'WEBP' } {
  if (!src || !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(src)) {
    return { isData: false, fmt: 'PNG' };
  }
  if (/image\/(jpeg|jpg)/i.test(src)) return { isData: true, fmt: 'JPEG' };
  if (/image\/webp/i.test(src)) return { isData: true, fmt: 'WEBP' };
  return { isData: true, fmt: 'PNG' };
}

function ClosingReportSheet({
  session,
  organization,
  branch,
  settings,
  metrics,
  drawerMovements,
  paperPreset,
  monochrome,
}: {
  session: CashSession;
  organization: Organization | null;
  branch: Branch | null;
  settings?: SystemSettings | null;
  metrics: ShiftMetrics;
  drawerMovements: CashSessionTransaction[];
  paperPreset: ClosingReportPaperPreset;
  monochrome: boolean;
}) {
  const sym = organization?.currencySymbol || 'GH₵';
  const safeLogo = sanitizeImageSrc(organization?.logoUrl);
  const taxInclusive = Boolean(settings?.taxIncludedInPrice);
  const taxLabel = `${organization?.taxLabel || 'VAT'}${taxInclusive ? ' Incl.' : ''}`;
  const formattedTaxDisplay = formatTaxDisplayValue({
    taxMinor: metrics.taxMinor,
    currencySymbol: sym,
    defaultTaxRateBps: organization?.defaultTaxRateBps,
    taxDisplayMode: settings?.taxDisplayMode,
  });
  const variance = session.differenceMinor ?? 0;
  const isThermal = paperPreset === 'thermal_80';

  return (
    <div
      className={`mx-auto bg-white ${
        isThermal ? 'max-w-[80mm] p-3.5 text-[11px] font-mono' : 'max-w-[700px] p-6 text-xs'
      } ${monochrome ? 'text-black grayscale' : 'text-slate-900'}`}
    >
      {/* Header */}
      <div className="text-center border-b border-dashed border-slate-400 pb-3 space-y-1">
        {safeLogo && (
          <img
            src={safeLogo}
            alt={organization?.businessName || 'Organization logo'}
            referrerPolicy="no-referrer"
            className={`${isThermal ? 'h-9' : 'h-12'} mx-auto object-contain mb-1.5`}
          />
        )}
        <p className={`${isThermal ? 'text-sm' : 'text-base'} font-bold uppercase text-slate-950`}>
          {organization?.businessName || 'Retail Store'}
        </p>
        {branch && (
          <p className="text-slate-600 font-medium">
            {branch.branchName} ({branch.branchCode})
          </p>
        )}
        {branch?.address && <p className="text-[10px] text-slate-500">{branch.address}</p>}
        <p className="pt-1 font-bold tracking-wider uppercase text-slate-900">
          End-of-Day Closing Report
        </p>
      </div>

      {/* Shift Metadata */}
      <div className="py-2.5 border-b border-dashed border-slate-400 space-y-1">
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Shift ID:</span>
          <span className="font-mono font-semibold">{session.sessionId}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Cashier:</span>
          <span className="font-semibold">{session.cashierName || session.cashierId}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Opened At:</span>
          <span className="font-mono tabular-nums">{formatDateTime(session.openedAt)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Closed At:</span>
          <span className="font-mono tabular-nums">
            {session.closedAt ? formatDateTime(session.closedAt) : formatDateTime(new Date())}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">Status:</span>
          <span className="uppercase font-semibold">{session.status}</span>
        </div>
      </div>

      {/* Cash Drawer Reconciliation */}
      <div className="py-2.5 border-b border-dashed border-slate-400 space-y-1">
        <p className="font-bold uppercase text-slate-800 pb-1">Cash Drawer Reconciliation</p>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">Opening Float</span>
          <span className="font-mono tabular-nums">
            {formatMoney(session.openingBalanceMinor, sym)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">+ Cash Sales</span>
          <span className="font-mono tabular-nums">
            +{formatMoney(session.cashSalesMinor, sym)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">+ Drawer Deposits</span>
          <span className="font-mono tabular-nums">
            +{formatMoney(session.cashDepositsMinor, sym)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">- Cash Refunds</span>
          <span className="font-mono tabular-nums">
            -{formatMoney(session.cashRefundsMinor, sym)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">- Drawer Withdrawals</span>
          <span className="font-mono tabular-nums">
            -{formatMoney(session.cashWithdrawalsMinor, sym)}
          </span>
        </div>
        <div className="flex justify-between gap-2 pt-1 border-t border-slate-200 font-semibold">
          <span>Expected Closing Cash</span>
          <span className="font-mono tabular-nums">
            {formatMoney(session.expectedClosingBalanceMinor, sym)}
          </span>
        </div>
        <div className="flex justify-between gap-2 font-semibold">
          <span>Actual Counted Cash</span>
          <span className="font-mono tabular-nums">
            {session.actualClosingBalanceMinor !== undefined
              ? formatMoney(session.actualClosingBalanceMinor, sym)
              : '—'}
          </span>
        </div>
        <div
          className={`flex justify-between gap-2 font-bold pt-1 border-t border-slate-300 ${
            monochrome
              ? 'text-black'
              : variance === 0
                ? 'text-emerald-700'
                : variance > 0
                  ? 'text-amber-700'
                  : 'text-rose-700'
          }`}
        >
          <span>
            Variance ({variance === 0 ? 'Balanced' : variance > 0 ? 'Over' : 'Short'})
          </span>
          <span className="font-mono tabular-nums">
            {variance > 0 ? '+' : ''}
            {formatMoney(variance, sym)}
          </span>
        </div>
      </div>

      {/* Shift Sales & Tender Breakdown */}
      <div className="py-2.5 border-b border-dashed border-slate-400 space-y-1">
        <p className="font-bold uppercase text-slate-800 pb-1">Shift Sales Summary</p>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">Completed Transactions</span>
          <span className="font-mono tabular-nums font-semibold">{metrics.transactionCount}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">Gross Sales</span>
          <span className="font-mono tabular-nums">
            {formatMoney(metrics.grossSalesMinor, sym)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">Total Discounts</span>
          <span className="font-mono tabular-nums">
            -{formatMoney(metrics.discountMinor, sym)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">Tax ({taxLabel})</span>
          <span className="font-mono tabular-nums">{formattedTaxDisplay}</span>
        </div>
        <div className="flex justify-between gap-2 font-bold pt-1 border-t border-slate-200">
          <span>Net Shift Sales</span>
          <span className="font-mono tabular-nums">{formatMoney(metrics.netSalesMinor, sym)}</span>
        </div>
        <div className="flex justify-between gap-2 text-slate-600 pt-1">
          <span>Processed Refunds ({metrics.refundCount})</span>
          <span className="font-mono tabular-nums">
            {formatMoney(metrics.refundTotalMinor, sym)}
          </span>
        </div>
      </div>

      {/* Tender Breakdown */}
      <div className="py-2.5 border-b border-dashed border-slate-400 space-y-1">
        <p className="font-bold uppercase text-slate-800 pb-1">Sales by Payment Method</p>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">Cash</span>
          <span className="font-mono tabular-nums">{formatMoney(metrics.byMethod.cash, sym)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">Mobile Money</span>
          <span className="font-mono tabular-nums">
            {formatMoney(metrics.byMethod.mobile_money, sym)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">Card</span>
          <span className="font-mono tabular-nums">{formatMoney(metrics.byMethod.card, sym)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-600">Bank Transfer</span>
          <span className="font-mono tabular-nums">
            {formatMoney(metrics.byMethod.bank_transfer, sym)}
          </span>
        </div>
        {metrics.byMethod.split > 0 && (
          <div className="flex justify-between gap-2">
            <span className="text-slate-600">Split Tender</span>
            <span className="font-mono tabular-nums">
              {formatMoney(metrics.byMethod.split, sym)}
            </span>
          </div>
        )}
      </div>

      {/* Manual Drawer Movements */}
      {drawerMovements.length > 0 && (
        <div className="py-2.5 border-b border-dashed border-slate-400 space-y-1.5">
          <p className="font-bold uppercase text-slate-800">Drawer Deposits &amp; Withdrawals</p>
          <div className="space-y-1">
            {drawerMovements.map((mov) => (
              <div key={mov.transactionId} className="flex justify-between gap-2 text-[10px]">
                <span className="text-slate-600 truncate">
                  {mov.type === 'deposit' ? 'Deposit' : 'Withdrawal'}
                  {mov.notes ? ` · ${mov.notes}` : ''} ({formatDateTime(mov.createdAt)})
                </span>
                <span className="font-mono tabular-nums font-semibold shrink-0">
                  {mov.type === 'deposit' ? '+' : '-'}
                  {formatMoney(mov.amountMinor, sym)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sign-off Block */}
      <div className="pt-4 space-y-4 text-[10px] text-slate-600">
        <div className="grid grid-cols-2 gap-6 pt-3">
          <div>
            <div className="border-b border-slate-400 h-6" />
            <p className="mt-1 font-medium">Cashier Signature</p>
          </div>
          <div>
            <div className="border-b border-slate-400 h-6" />
            <p className="mt-1 font-medium">Supervisor / Manager Sign-off</p>
          </div>
        </div>
        <p className="text-center text-slate-400 pt-1">
          Printed {new Date().toLocaleString('en-GB')}
        </p>
      </div>
    </div>
  );
}

export function CashClosingReportModal({
  open,
  onClose,
  session,
  organization,
  branch,
  settings,
  sales,
  refunds,
}: CashClosingReportModalProps) {
  const { notify } = useToast();
  const [paperPreset, setPaperPreset] = useState<ClosingReportPaperPreset>('thermal_80');
  const [monochrome, setMonochrome] = useState(true);
  const [printBlocked, setPrintBlocked] = useState(false);
  const [drawerMovements, setDrawerMovements] = useState<CashSessionTransaction[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);

  const isEmbeddedIframe = useMemo(() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }, []);

  useEffect(() => {
    if (!open || !session) return;
    let active = true;
    setLoadingMovements(true);
    setPrintBlocked(false);

    getDocs(
      query(
        collection(db, 'cashSessions', session.sessionId, 'transactions'),
        where('organizationId', '==', session.organizationId)
      )
    )
      .then((snap) => {
        if (!active) return;
        const rows = snap.docs
          .map((d) => d.data() as CashSessionTransaction)
          .filter((t) => t.type === 'deposit' || t.type === 'withdrawal')
          .sort(
            (a, b) =>
              timestampToDate(a.createdAt).getTime() - timestampToDate(b.createdAt).getTime()
          );
        setDrawerMovements(rows);
      })
      .catch(() => {
        if (active) setDrawerMovements([]);
      })
      .finally(() => {
        if (active) setLoadingMovements(false);
      });

    return () => {
      active = false;
    };
  }, [open, session]);

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

  const metrics: ShiftMetrics = useMemo(() => {
    const empty: ShiftMetrics = {
      transactionCount: 0,
      grossSalesMinor: 0,
      discountMinor: 0,
      taxMinor: 0,
      netSalesMinor: 0,
      refundCount: 0,
      refundTotalMinor: 0,
      byMethod: {
        cash: 0,
        mobile_money: 0,
        card: 0,
        bank_transfer: 0,
        split: 0,
      },
    };
    if (!session) return empty;

    const openedMs = timestampToDate(session.openedAt).getTime();
    const closedMs = session.closedAt ? timestampToDate(session.closedAt).getTime() : Date.now();
    const windowEnd = closedMs > 0 ? closedMs + 5000 : Date.now() + 5000;

    for (const s of sales) {
      if (s.branchId !== session.branchId || s.saleStatus === 'cancelled') continue;
      const saleMs = timestampToDate(s.createdAt).getTime();
      const matchesSession =
        s.cashSessionId === session.sessionId ||
        (!s.cashSessionId &&
          s.cashierId === session.cashierId &&
          openedMs > 0 &&
          saleMs >= openedMs &&
          saleMs <= windowEnd);
      if (!matchesSession) continue;

      empty.transactionCount += 1;
      empty.grossSalesMinor += s.subtotalMinor || 0;
      empty.discountMinor += s.discountMinor || 0;
      empty.taxMinor += s.taxMinor || 0;
      empty.netSalesMinor += s.totalMinor || 0;

      if (s.paymentMethod in empty.byMethod) {
        empty.byMethod[s.paymentMethod] += s.totalMinor || 0;
      }
    }

    for (const r of refunds) {
      if (r.branchId !== session.branchId || r.status !== 'processed') continue;
      const refMs = timestampToDate(r.createdAt).getTime();
      if (openedMs > 0 && refMs >= openedMs && refMs <= windowEnd) {
        empty.refundCount += 1;
        empty.refundTotalMinor += r.refundTotalMinor || 0;
      }
    }

    return empty;
  }, [session, sales, refunds]);

  if (!open || !session) return null;

  const sym = organization?.currencySymbol || 'GH₵';
  const taxInclusive = Boolean(settings?.taxIncludedInPrice);
  const taxLabel = `${organization?.taxLabel || 'VAT'}${taxInclusive ? ' Incl.' : ''}`;
  const formattedTaxDisplay = formatTaxDisplayValue({
    taxMinor: metrics.taxMinor,
    currencySymbol: sym,
    defaultTaxRateBps: organization?.defaultTaxRateBps,
    taxDisplayMode: settings?.taxDisplayMode,
  });

  const handlePrint = () => {
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
          'This embedded preview blocks browser print dialogs. Use Download PDF or open in a full browser tab.'
        );
      }
    } catch (err) {
      window.clearTimeout(safetyTimer);
      cleanup();
      setPrintBlocked(true);
      notify(
        'error',
        'Printer Dialog Blocked',
        err instanceof Error ? err.message : 'Unable to open browser printer dialog.'
      );
    }
  };

  const handleDownloadPdf = () => {
    const safeLogo = sanitizeImageSrc(organization?.logoUrl);
    const { isData, fmt } = getLogoFormat(safeLogo || undefined);
    const variance = session.differenceMinor ?? 0;
    const closedLabel = session.closedAt
      ? formatDateTime(session.closedAt)
      : formatDateTime(new Date());

    if (paperPreset === 'a4_portrait') {
      const docPdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      const pageW = docPdf.internal.pageSize.getWidth();
      const margin = 44;
      let y = 44;

      if (isData && safeLogo) {
        try {
          docPdf.addImage(safeLogo, fmt, pageW / 2 - 22, y - 10, 44, 44);
          y += 44;
        } catch {
          // Ignore unreadable image dimensions
        }
      }

      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(15);
      docPdf.text(organization?.businessName || 'Retail Store', pageW / 2, y, { align: 'center' });
      y += 16;

      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(10);
      if (branch) {
        docPdf.text(`${branch.branchName} (${branch.branchCode})`, pageW / 2, y, {
          align: 'center',
        });
        y += 14;
      }

      docPdf.setFont('helvetica', 'bold');
      docPdf.setFontSize(11);
      docPdf.text('END-OF-DAY CLOSING REPORT', pageW / 2, y, { align: 'center' });
      y += 16;

      docPdf.setDrawColor(203, 213, 225);
      docPdf.line(margin, y, pageW - margin, y);
      y += 18;

      docPdf.setFont('helvetica', 'normal');
      docPdf.setFontSize(10);
      docPdf.text(`Shift ID: ${session.sessionId}`, margin, y);
      docPdf.text(`Status: ${session.status.toUpperCase()}`, pageW - margin, y, { align: 'right' });
      y += 14;
      docPdf.text(`Cashier: ${session.cashierName || session.cashierId}`, margin, y);
      docPdf.text(`Opened: ${formatDateTime(session.openedAt)}`, pageW - margin, y, {
        align: 'right',
      });
      y += 14;
      docPdf.text(`Closed: ${closedLabel}`, pageW - margin, y, { align: 'right' });
      y += 20;

      const drawSection = (title: string, rows: Array<[string, string]>) => {
        if (y > 720) {
          docPdf.addPage();
          y = 48;
        }
        docPdf.setFillColor(241, 245, 249);
        docPdf.rect(margin, y, pageW - margin * 2, 20, 'F');
        docPdf.setFont('helvetica', 'bold');
        docPdf.setFontSize(10);
        docPdf.text(title, margin + 8, y + 14);
        y += 28;

        docPdf.setFont('helvetica', 'normal');
        for (const [label, val] of rows) {
          if (y > 760) {
            docPdf.addPage();
            y = 48;
          }
          docPdf.text(label, margin + 8, y);
          docPdf.text(val, pageW - margin - 8, y, { align: 'right' });
          y += 15;
        }
        y += 10;
      };

      drawSection('Cash Drawer Reconciliation', [
        ['Opening Float', formatMoney(session.openingBalanceMinor, sym)],
        ['+ Cash Sales', `+${formatMoney(session.cashSalesMinor, sym)}`],
        ['+ Drawer Deposits', `+${formatMoney(session.cashDepositsMinor, sym)}`],
        ['- Cash Refunds', `-${formatMoney(session.cashRefundsMinor, sym)}`],
        ['- Drawer Withdrawals', `-${formatMoney(session.cashWithdrawalsMinor, sym)}`],
        ['Expected Closing Cash', formatMoney(session.expectedClosingBalanceMinor, sym)],
        [
          'Actual Counted Cash',
          session.actualClosingBalanceMinor !== undefined
            ? formatMoney(session.actualClosingBalanceMinor, sym)
            : '—',
        ],
        [
          `Variance (${variance === 0 ? 'Balanced' : variance > 0 ? 'Over' : 'Short'})`,
          `${variance > 0 ? '+' : ''}${formatMoney(variance, sym)}`,
        ],
      ]);

      drawSection('Shift Sales & Tender Summary', [
        ['Completed Transactions', String(metrics.transactionCount)],
        ['Gross Sales', formatMoney(metrics.grossSalesMinor, sym)],
        ['Discounts', `-${formatMoney(metrics.discountMinor, sym)}`],
        [`Tax (${taxLabel})`, formattedTaxDisplay],
        ['Net Shift Sales', formatMoney(metrics.netSalesMinor, sym)],
        [`Processed Refunds (${metrics.refundCount})`, formatMoney(metrics.refundTotalMinor, sym)],
        ['Cash Sales Total', formatMoney(metrics.byMethod.cash, sym)],
        ['Mobile Money Sales', formatMoney(metrics.byMethod.mobile_money, sym)],
        ['Card Sales', formatMoney(metrics.byMethod.card, sym)],
        ['Bank Transfer Sales', formatMoney(metrics.byMethod.bank_transfer, sym)],
      ]);

      if (drawerMovements.length > 0) {
        drawSection(
          'Manual Drawer Movements',
          drawerMovements.map((m) => [
            `${m.type === 'deposit' ? 'Deposit' : 'Withdrawal'}${m.notes ? ` (${m.notes})` : ''}`.slice(
              0,
              54
            ),
            `${m.type === 'deposit' ? '+' : '-'}${formatMoney(m.amountMinor, sym)}`,
          ])
        );
      }

      y += 18;
      docPdf.line(margin, y, margin + 180, y);
      docPdf.line(pageW - margin - 180, y, pageW - margin, y);
      y += 14;
      docPdf.setFontSize(9);
      docPdf.text('Cashier Signature', margin, y);
      docPdf.text('Supervisor Sign-off', pageW - margin - 180, y);

      docPdf.save(`closing-report-${session.sessionId}.pdf`);
      return;
    }

    // Thermal 80mm roll PDF
    const widthMm = 80;
    const centerX = widthMm / 2;
    const leftX = 4;
    const rightX = widthMm - 4;
    const estimatedHeight = Math.max(190, 155 + drawerMovements.length * 6);
    const docPdf = new jsPDF({ unit: 'mm', format: [widthMm, estimatedHeight] });
    let y = 8;

    if (isData && safeLogo) {
      try {
        docPdf.addImage(safeLogo, fmt, centerX - 6, 4, 12, 12);
        y = 20;
      } catch {
        // Ignore invalid image data
      }
    }

    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(10.5);
    docPdf.text(organization?.businessName || 'Retail Store', centerX, y, { align: 'center' });
    y += 4.2;

    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(8);
    if (branch) {
      docPdf.text(`${branch.branchName} (${branch.branchCode})`, centerX, y, { align: 'center' });
      y += 3.8;
    }
    docPdf.setFont('helvetica', 'bold');
    docPdf.text('END-OF-DAY CLOSING REPORT', centerX, y, { align: 'center' });
    y += 4;

    const divider = '------------------------------------------';
    docPdf.setFont('helvetica', 'normal');
    docPdf.text(divider, centerX, y, { align: 'center' });
    y += 3.8;

    docPdf.text(`Shift: ${session.sessionId}`, leftX, y);
    y += 3.6;
    docPdf.text(`Cashier: ${session.cashierName || session.cashierId}`, leftX, y);
    y += 3.6;
    docPdf.text(`Opened: ${formatDateTime(session.openedAt)}`, leftX, y);
    y += 3.6;
    docPdf.text(`Closed: ${closedLabel}`, leftX, y);
    y += 3.6;
    docPdf.text(`Status: ${session.status.toUpperCase()}`, leftX, y);
    y += 3.8;

    docPdf.text(divider, centerX, y, { align: 'center' });
    y += 4;

    const writePair = (label: string, val: string, bold = false) => {
      docPdf.setFont('helvetica', bold ? 'bold' : 'normal');
      docPdf.text(label, leftX, y);
      docPdf.text(val, rightX, y, { align: 'right' });
      y += 3.8;
    };

    docPdf.setFont('helvetica', 'bold');
    docPdf.text('CASH RECONCILIATION', leftX, y);
    y += 4;
    writePair('Opening Float', formatMoney(session.openingBalanceMinor, sym));
    writePair('+ Cash Sales', `+${formatMoney(session.cashSalesMinor, sym)}`);
    writePair('+ Deposits', `+${formatMoney(session.cashDepositsMinor, sym)}`);
    writePair('- Cash Refunds', `-${formatMoney(session.cashRefundsMinor, sym)}`);
    writePair('- Withdrawals', `-${formatMoney(session.cashWithdrawalsMinor, sym)}`);
    writePair('Expected Cash', formatMoney(session.expectedClosingBalanceMinor, sym), true);
    writePair(
      'Actual Counted',
      session.actualClosingBalanceMinor !== undefined
        ? formatMoney(session.actualClosingBalanceMinor, sym)
        : '—',
      true
    );
    writePair(
      `Variance (${variance === 0 ? 'Balanced' : variance > 0 ? 'Over' : 'Short'})`,
      `${variance > 0 ? '+' : ''}${formatMoney(variance, sym)}`,
      true
    );

    docPdf.setFont('helvetica', 'normal');
    docPdf.text(divider, centerX, y, { align: 'center' });
    y += 4;

    docPdf.setFont('helvetica', 'bold');
    docPdf.text('SHIFT SALES SUMMARY', leftX, y);
    y += 4;
    writePair('Transactions', String(metrics.transactionCount));
    writePair('Gross Sales', formatMoney(metrics.grossSalesMinor, sym));
    writePair('Discounts', `-${formatMoney(metrics.discountMinor, sym)}`);
    writePair(`Tax (${taxLabel})`, formattedTaxDisplay);
    writePair('Net Sales', formatMoney(metrics.netSalesMinor, sym), true);
    writePair('Cash Tender', formatMoney(metrics.byMethod.cash, sym));
    writePair('Mobile Money', formatMoney(metrics.byMethod.mobile_money, sym));
    writePair('Card', formatMoney(metrics.byMethod.card, sym));
    writePair('Bank Transfer', formatMoney(metrics.byMethod.bank_transfer, sym));
    if (metrics.refundCount > 0) {
      writePair(
        `Refunds (${metrics.refundCount})`,
        formatMoney(metrics.refundTotalMinor, sym)
      );
    }

    y += 4;
    docPdf.setFont('helvetica', 'normal');
    docPdf.text('Cashier Sign: _______________________', leftX, y);
    y += 5;
    docPdf.text('Manager Sign: _______________________', leftX, y);

    docPdf.save(`closing-report-${session.sessionId}.pdf`);
  };

  const printPortal = createPortal(
    <div id="ledgerbranch-print-sheet" className="hidden print:block bg-white text-black">
      <style>{`
        @page {
          size: ${paperPreset === 'thermal_80' ? '80mm auto' : 'A4 portrait'};
          margin: ${paperPreset === 'thermal_80' ? '3mm' : '12mm'};
        }
      `}</style>
      <ClosingReportSheet
        session={session}
        organization={organization}
        branch={branch}
        settings={settings}
        metrics={metrics}
        drawerMovements={drawerMovements}
        paperPreset={paperPreset}
        monochrome={monochrome}
      />
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
                <FileText className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 truncate">
                  End-of-Day Closing Report — {session.cashierName || session.cashierId}
                </h3>
                <p className="text-[11px] text-slate-500 truncate">
                  Print shift reconciliation summary or download a PDF copy
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              aria-label="Close closing report"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="grid grid-cols-1 md:grid-cols-5 flex-1 min-h-0 overflow-hidden">
            {/* Options Column */}
            <div className="md:col-span-2 p-5 border-b md:border-b-0 md:border-r border-slate-200 space-y-4 overflow-y-auto bg-white">
              <div>
                <label
                  htmlFor="eod-paper-preset"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Paper Size
                </label>
                <select
                  id="eod-paper-preset"
                  value={paperPreset}
                  onChange={(e) => setPaperPreset(e.target.value as ClosingReportPaperPreset)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900"
                >
                  <option value="thermal_80">Thermal 80mm Roll</option>
                  <option value="a4_portrait">A4 Sheet (Portrait)</option>
                </select>
              </div>

              <label className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-700 cursor-pointer select-none hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={monochrome}
                  onChange={(e) => setMonochrome(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Monochrome / B&amp;W Mode</span>
              </label>

              {loadingMovements && (
                <p className="text-[11px] text-slate-500">Loading drawer cash movements...</p>
              )}

              {(printBlocked || isEmbeddedIframe) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-amber-900 leading-relaxed">
                      <p className="font-semibold">
                        {printBlocked
                          ? 'Preview frame blocked browser print dialog'
                          : 'Running inside an embedded preview'}
                      </p>
                      <p className="mt-0.5 text-amber-800">
                        You can download the PDF directly here, or open the app in a full browser tab to print directly to hardware printers.
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

            {/* Live Preview */}
            <div className="md:col-span-3 bg-slate-100 p-4 overflow-y-auto flex flex-col">
              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2">
                <span className="font-medium">
                  Report Preview ({paperPreset === 'thermal_80' ? '80mm Thermal' : 'A4 Portrait'})
                </span>
                <span className="font-mono">{session.sessionId}</span>
              </div>
              <div className="flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                <ClosingReportSheet
                  session={session}
                  organization={organization}
                  branch={branch}
                  settings={settings}
                  metrics={metrics}
                  drawerMovements={drawerMovements}
                  paperPreset={paperPreset}
                  monochrome={monochrome}
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-t border-slate-200 bg-slate-50/70">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadPdf}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Closing Report
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
