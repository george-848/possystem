import React, { useMemo, useState } from 'react';
import { Barcode, Download, Plus, Printer, Search, Trash2, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { isProductAvailableAtBranch } from '../lib/barcode';
import { encodeBarcodeValue, type BarcodeSymbology } from '../lib/barcodeGenerator';
import { formatMoney, toMinorUnits } from '../lib/money';
import {
  BarcodeLabelsSheet,
  downloadBarcodeLabelsPdf,
  expandBarcodeLabels,
  type BarcodeLabelConfig,
  type BarcodeLabelItem,
  type BarcodeLabelLayout,
} from './BarcodeLabelSheet';
import { PrintOptionsModal } from './PrintOptionsModal';

type CodeSourceMode = 'prefer_barcode' | 'sku_only' | 'barcode_only';

export function BarcodePrintTab() {
  const { organization, activeBranchId } = useAuth();
  const { products, branchInventory } = useData();
  const { notify } = useToast();

  const [search, setSearch] = useState('');
  const [codeSource, setCodeSource] = useState<CodeSourceMode>('prefer_barcode');
  const [symbology, setSymbology] = useState<BarcodeSymbology>('auto');
  const [layout, setLayout] = useState<BarcodeLabelLayout>('a4_3col');
  const [showBusinessName, setShowBusinessName] = useState(true);
  const [showProductName, setShowProductName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showCodeText, setShowCodeText] = useState(true);

  const [queue, setQueue] = useState<BarcodeLabelItem[]>([]);
  const [printOpen, setPrintOpen] = useState(false);

  // Custom one-off label fields
  const [customTitle, setCustomTitle] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [customPriceStr, setCustomPriceStr] = useState('0.00');
  const [customCopies, setCustomCopies] = useState('1');

  const sym = organization?.currencySymbol || 'GH₵';

  const branchPriceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of branchInventory) {
      if (inv.branchId === activeBranchId) {
        map.set(inv.productId, inv.sellingPriceMinor);
      }
    }
    return map;
  }, [branchInventory, activeBranchId]);

  const activeProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => isProductAvailableAtBranch(p, activeBranchId))
      .filter((p) => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q))
        );
      });
  }, [products, activeBranchId, search]);

  const resolveProductCode = (sku: string, barcode?: string): string => {
    if (codeSource === 'sku_only') return sku.trim();
    if (codeSource === 'barcode_only') return (barcode || '').trim();
    return (barcode || '').trim() || sku.trim();
  };

  const addProductToQueue = (productId: string) => {
    const prod = products.find((p) => p.productId === productId);
    if (!prod) return;
    const code = resolveProductCode(prod.sku, prod.barcode);
    if (!code) {
      notify('error', 'Missing Barcode', `${prod.name} does not have a product barcode set.`);
      return;
    }

    const priceMinor = branchPriceMap.get(prod.productId) ?? prod.sellingPriceMinor;
    setQueue((prev) => {
      const existing = prev.find((item) => item.id === prod.productId);
      if (existing) {
        return prev.map((item) =>
          item.id === prod.productId
            ? { ...item, code, priceMinor, copies: Math.min(100, item.copies + 1) }
            : item
        );
      }
      return [
        ...prev,
        {
          id: prod.productId,
          productName: prod.name,
          code,
          sku: prod.sku,
          priceMinor,
          copies: 1,
        },
      ];
    });
  };

  const handleAddVisible = () => {
    const nextAdditions: BarcodeLabelItem[] = [];
    const existingIds = new Set(queue.map((q) => q.id));

    for (const prod of activeProducts.slice(0, 40)) {
      if (existingIds.has(prod.productId)) continue;
      const code = resolveProductCode(prod.sku, prod.barcode);
      if (!code) continue;
      nextAdditions.push({
        id: prod.productId,
        productName: prod.name,
        code,
        sku: prod.sku,
        priceMinor: branchPriceMap.get(prod.productId) ?? prod.sellingPriceMinor,
        copies: 1,
      });
    }

    if (nextAdditions.length === 0) {
      notify('info', 'No Labels Added', 'Visible products are already queued or lack codes.');
      return;
    }

    setQueue((prev) => [...prev, ...nextAdditions]);
    notify('success', 'Labels Queued', `Added ${nextAdditions.length} product label(s) to queue.`);
  };

  const handleAddCustomLabel = (e: React.FormEvent) => {
    e.preventDefault();
    const code = customCode.trim();
    if (!code) return;
    const copies = Math.max(1, Math.min(100, Number.parseInt(customCopies || '1', 10) || 1));
    const title = customTitle.trim() || code;
    const priceMinor = Math.max(0, toMinorUnits(customPriceStr));

    setQueue((prev) => [
      ...prev,
      {
        id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        productName: title,
        code,
        sku: code,
        priceMinor,
        copies,
      },
    ]);
    setCustomTitle('');
    setCustomCode('');
    setCustomCopies('1');
  };

  const labelConfig: BarcodeLabelConfig = {
    symbology,
    layout,
    showBusinessName,
    showProductName,
    showPrice,
    showCodeText,
  };

  const totalLabelCount = useMemo(() => expandBarcodeLabels(queue).length, [queue]);

  const handleDownloadPdf = () => {
    if (queue.length === 0) {
      notify('info', 'No Labels Queued', 'Add at least one item to generate a barcode PDF.');
      return;
    }
    downloadBarcodeLabelsPdf({
      organization,
      items: queue,
      config: labelConfig,
    });
    notify('success', 'Label PDF Downloaded', `Saved ${totalLabelCount} barcode label(s) as PDF.`);
  };

  const handleOpenPrint = () => {
    if (queue.length === 0) {
      notify('info', 'No Labels Queued', 'Add at least one item before opening the print dialog.');
      return;
    }
    setPrintOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left: Catalog Selection & Custom Code */}
        <div className="xl:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Barcode className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">1. Select Products for Labels</h3>
              </div>
              <button
                type="button"
                onClick={handleAddVisible}
                className="text-xs font-medium text-emerald-700 hover:underline"
              >
                + Add Visible
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Code Source
                </label>
                <select
                  value={codeSource}
                  onChange={(e) => setCodeSource(e.target.value as CodeSourceMode)}
                  className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                >
                  <option value="prefer_barcode">Barcode (Fallback SKU)</option>
                  <option value="sku_only">SKU Only</option>
                  <option value="barcode_only">Barcode Only</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Barcode Format
                </label>
                <select
                  value={symbology}
                  onChange={(e) => setSymbology(e.target.value as BarcodeSymbology)}
                  className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                >
                  <option value="auto">Auto (EAN-13 / Code 128)</option>
                  <option value="code128">Code 128 (SKU / Any)</option>
                  <option value="ean13">EAN-13 (12–13 Digits)</option>
                </select>
              </div>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search active products by name, SKU, or barcode..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg"
              />
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {activeProducts.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">
                  No active products match your search.
                </p>
              ) : (
                activeProducts.map((p) => {
                  const resolvedCode = resolveProductCode(p.sku, p.barcode);
                  const queued = queue.find((item) => item.id === p.productId);
                  const price = branchPriceMap.get(p.productId) ?? p.sellingPriceMinor;
                  return (
                    <div
                      key={p.productId}
                      className="px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">{p.name}</p>
                        <p className="text-[11px] font-mono text-slate-500 truncate tabular-nums">
                          {resolvedCode || 'No code'} · {formatMoney(price, sym)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!resolvedCode}
                        onClick={() => addProductToQueue(p.productId)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 shrink-0"
                      >
                        <Plus className="w-3 h-3" />
                        {queued ? `Queued (${queued.copies})` : 'Add'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Custom / Ad-hoc Barcode Generator */}
          <form
            onSubmit={handleAddCustomLabel}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
          >
            <h3 className="text-xs font-bold text-slate-900 border-b border-slate-200 pb-2">
              Custom Shelf / Ad-Hoc Barcode Label
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Label Title
                </label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="e.g., Bottled Water 500ml"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Barcode / SKU Value *
                </label>
                <input
                  type="text"
                  required
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  placeholder="e.g., 5449000000996 or SKU-01"
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Price ({sym})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={customPriceStr}
                  onChange={(e) => setCustomPriceStr(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Copies
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={customCopies}
                  onChange={(e) => setCustomCopies(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Custom Label
              </button>
            </div>
          </form>
        </div>

        {/* Right: Label Layout, Queue & Live Preview */}
        <div className="xl:col-span-7 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  2. Label Layout &amp; Print Queue ({totalLabelCount} label{totalLabelCount === 1 ? '' : 's'})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Configure sticker layout and fields before printing or exporting a vector PDF
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {queue.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setQueue([])}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  Save PDF
                </button>
                <button
                  type="button"
                  onClick={handleOpenPrint}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Labels
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Sticker / Paper Layout
                </label>
                <select
                  value={layout}
                  onChange={(e) => setLayout(e.target.value as BarcodeLabelLayout)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                >
                  <option value="a4_3col">A4 Sheet — 3 Columns (24/page)</option>
                  <option value="a4_4col">A4 Sheet — 4 Columns (40/page)</option>
                  <option value="thermal_roll">Thermal Label Roll (50 × 30 mm)</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 sm:pt-5 text-xs text-slate-700">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showBusinessName}
                    onChange={(e) => setShowBusinessName(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>Store Name</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showProductName}
                    onChange={(e) => setShowProductName(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>Product Name</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCodeText}
                    onChange={(e) => setShowCodeText(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>Code Text</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPrice}
                    onChange={(e) => setShowPrice(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>Price</span>
                </label>
              </div>
            </div>

            {/* Queued Items List */}
            {queue.length > 0 && (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {queue.map((item) => {
                  const encoded = encodeBarcodeValue(item.code, symbology);
                  return (
                    <div
                      key={item.id}
                      className="px-3 py-2 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900 truncate">{item.productName}</p>
                        <p className="text-[11px] font-mono text-slate-500 truncate">
                          {encoded.displayValue} · {encoded.format.replace('_', '-')}
                          {encoded.warning ? ` · ${encoded.warning}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <label className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                          <span>Qty:</span>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={item.copies}
                            onChange={(e) => {
                              const nextQty = Math.max(
                                1,
                                Math.min(100, Number.parseInt(e.target.value || '1', 10) || 1)
                              );
                              setQueue((prev) =>
                                prev.map((row) =>
                                  row.id === item.id ? { ...row, copies: nextQty } : row
                                )
                              );
                            }}
                            className="w-14 px-2 py-1 text-right font-mono border border-slate-200 rounded"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setQueue((prev) => prev.filter((row) => row.id !== item.id))
                          }
                          className="p-1 text-slate-400 hover:text-rose-600"
                          aria-label={`Remove ${item.productName}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Live Sticker Sheet Preview */}
            <div className="border border-slate-200 rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] font-medium text-slate-500 mb-2">
                Live Printable Label Preview
              </p>
              <div className="rounded-lg border border-slate-200 bg-white max-h-[360px] overflow-y-auto">
                <BarcodeLabelsSheet
                  organization={organization}
                  items={queue}
                  config={labelConfig}
                  monochrome
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <PrintOptionsModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        document={{
          kind: 'barcode_labels',
          title: `Barcode Labels (${totalLabelCount})`,
          organizationName: organization?.businessName || 'LedgerBranch POS',
          barcodeData: {
            organization,
            items: queue,
            config: labelConfig,
          },
        }}
      />
    </div>
  );
}
