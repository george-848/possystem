import { useMemo, useState } from 'react';
import { Printer, ReceiptText, Search } from 'lucide-react';
import { PrintOptionsModal } from '../components/PrintOptionsModal';
import { ReceiptModal } from '../components/ReceiptModal';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime, formatMoney } from '../lib/money';
import { fetchSaleItems } from '../services/posService';
import type { Sale, SaleItem } from '../types/pos';

export function SalesPage() {
  const { organization, branches, activeBranchId, isSuperAdmin, systemSettings } = useAuth();
  const { sales } = useData();
  const { notify } = useToast();

  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('active');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [selectedItems, setSelectedItems] = useState<SaleItem[]>([]);
  const [printTarget, setPrintTarget] = useState<{ sale: Sale; items: SaleItem[] } | null>(null);

  const sym = organization?.currencySymbol || 'GH₵';
  const branchMap = useMemo(
    () => new Map(branches.map((b) => [b.branchId, b])),
    [branches]
  );

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (!isSuperAdmin && s.branchId !== activeBranchId) return false;
      if (isSuperAdmin && branchFilter === 'active' && s.branchId !== activeBranchId) return false;
      if (isSuperAdmin && branchFilter !== 'all' && branchFilter !== 'active' && s.branchId !== branchFilter)
        return false;
      if (!q) return true;
      return (
        s.transactionNumber.toLowerCase().includes(q) ||
        (s.cashierName && s.cashierName.toLowerCase().includes(q)) ||
        (s.customerName && s.customerName.toLowerCase().includes(q))
      );
    });
  }, [sales, isSuperAdmin, activeBranchId, branchFilter, search]);

  const handleOpenReceipt = async (sale: Sale) => {
    if (!organization) return;
    try {
      const items = await fetchSaleItems(sale.saleId, organization.organizationId);
      setSelectedItems(items);
      setSelectedSale(sale);
    } catch (err) {
      notify('error', 'Failed to load receipt', err instanceof Error ? err.message : 'Error');
    }
  };

  const handleDirectPrintReceipt = async (sale: Sale) => {
    if (!organization) return;
    try {
      const items = await fetchSaleItems(sale.saleId, organization.organizationId);
      setPrintTarget({ sale, items });
    } catch (err) {
      notify('error', 'Failed to load receipt', err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 font-display">
            Sales & Receipt Ledger
          </h2>
          <p className="text-xs text-slate-500">
            Inspect completed transactions, print thermal receipts, and export PDF copies
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search receipt number, cashier, or customer..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg"
          />
        </div>
        {isSuperAdmin && (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
          >
            <option value="active">Active Branch Only</option>
            <option value="all">All Branches</option>
            {branches.map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {b.branchCode} — {b.branchName}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Receipt No.</th>
                <th className="text-left px-5 py-3 font-medium">Date</th>
                <th className="text-left px-5 py-3 font-medium">Branch</th>
                <th className="text-left px-5 py-3 font-medium">Cashier</th>
                <th className="text-left px-5 py-3 font-medium">Customer</th>
                <th className="text-left px-5 py-3 font-medium">Payment</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-right px-5 py-3 font-medium">Total</th>
                <th className="text-right px-5 py-3 font-medium">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSales.map((s) => (
                <tr key={s.saleId} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono text-xs font-semibold text-slate-900">
                    {s.transactionNumber}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">
                    {formatDateTime(s.createdAt)}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-600">
                    {branchMap.get(s.branchId)?.branchCode || s.branchId}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-700">{s.cashierName || 'Staff'}</td>
                  <td className="px-5 py-3 text-xs text-slate-600">
                    {s.customerName || 'Walk-in'}
                  </td>
                  <td className="px-5 py-3 text-xs capitalize text-slate-600">
                    {s.paymentMethod.replace('_', ' ')}
                  </td>
                  <td className="px-5 py-3 text-xs capitalize">
                    <span
                      className={
                        s.saleStatus === 'completed'
                          ? 'text-emerald-700 font-medium'
                          : 'text-amber-700 font-medium'
                      }
                    >
                      {s.saleStatus.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs font-semibold tabular-nums text-slate-900">
                    {formatMoney(s.totalMinor, sym)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleOpenReceipt(s)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <ReceiptText className="w-3.5 h-3.5" />
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDirectPrintReceipt(s)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Print
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredSales.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-xs text-slate-500">
                    No sales records match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ReceiptModal
        open={Boolean(selectedSale)}
        onClose={() => setSelectedSale(null)}
        organization={organization}
        branch={selectedSale ? branchMap.get(selectedSale.branchId) || null : null}
        settings={systemSettings}
        sale={selectedSale}
        items={selectedItems}
      />

      <PrintOptionsModal
        open={Boolean(printTarget && organization)}
        onClose={() => setPrintTarget(null)}
        document={
          printTarget && organization
            ? {
                kind: 'receipt',
                title: `Receipt ${printTarget.sale.transactionNumber}`,
                organizationName: organization.businessName,
                branchLabel: branchMap.get(printTarget.sale.branchId)?.branchName,
                receiptData: {
                  organization,
                  branch: branchMap.get(printTarget.sale.branchId) || null,
                  settings: systemSettings,
                  sale: printTarget.sale,
                  items: printTarget.items,
                },
              }
            : null
        }
      />
    </div>
  );
}
