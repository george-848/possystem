import { jsPDF } from 'jspdf';
import {
  encodeBarcodeValue,
  getBarcodeBarRuns,
  type BarcodeSymbology,
} from '../lib/barcodeGenerator';
import { formatMoney } from '../lib/money';
import type { Organization } from '../types/pos';

export interface BarcodeLabelItem {
  id: string;
  productName: string;
  code: string;
  sku: string;
  priceMinor: number;
  copies: number;
}

export type BarcodeLabelLayout = 'thermal_roll' | 'a4_3col' | 'a4_4col';

export interface BarcodeLabelConfig {
  symbology: BarcodeSymbology;
  layout: BarcodeLabelLayout;
  showBusinessName: boolean;
  showProductName: boolean;
  showPrice: boolean;
  showCodeText: boolean;
}

export function BarcodeSvg({
  value,
  symbology,
  className = 'w-full h-11',
}: {
  value: string;
  symbology: BarcodeSymbology;
  className?: string;
}) {
  const encoded = encodeBarcodeValue(value, symbology);
  const runs = getBarcodeBarRuns(encoded.modules);
  const quietZone = 8;
  const totalWidth = encoded.modules.length + quietZone * 2;

  return (
    <svg
      viewBox={`0 0 ${totalWidth} 44`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className={className}
      role="img"
      aria-label={`Barcode ${encoded.displayValue}`}
    >
      <rect x={0} y={0} width={totalWidth} height={44} fill="#ffffff" />
      {runs.map((run, idx) => (
        <rect
          key={idx}
          x={quietZone + run.x}
          y={2}
          width={run.w}
          height={40}
          fill="#000000"
        />
      ))}
    </svg>
  );
}

export function expandBarcodeLabels(items: BarcodeLabelItem[]): Array<BarcodeLabelItem & { copyIndex: number }> {
  const expanded: Array<BarcodeLabelItem & { copyIndex: number }> = [];
  for (const item of items) {
    const count = Math.max(1, Math.min(100, Math.round(item.copies) || 1));
    for (let i = 0; i < count; i++) {
      expanded.push({ ...item, copyIndex: i });
    }
  }
  return expanded;
}

export function BarcodeLabelsSheet({
  organization,
  items,
  config,
  monochrome = true,
}: {
  organization: Organization | null;
  items: BarcodeLabelItem[];
  config: BarcodeLabelConfig;
  monochrome?: boolean;
}) {
  const sym = organization?.currencySymbol || 'GH₵';
  const businessName = organization?.businessName || 'Multi-Branch POS System';
  const labels = expandBarcodeLabels(items);

  if (labels.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-slate-500">
        Add at least one product or custom code to preview printable barcode labels.
      </div>
    );
  }

  const gridClass =
    config.layout === 'thermal_roll'
      ? 'max-w-[54mm] mx-auto grid grid-cols-1 gap-2.5 p-2'
      : config.layout === 'a4_4col'
        ? 'grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-4'
        : 'grid grid-cols-2 sm:grid-cols-3 gap-3 p-4';

  return (
    <div className={`bg-white ${monochrome ? 'text-black grayscale' : 'text-slate-900'}`}>
      <div className={gridClass}>
        {labels.map((label) => {
          const encoded = encodeBarcodeValue(label.code, config.symbology);
          return (
            <div
              key={`${label.id}_${label.copyIndex}`}
              className="border border-dashed border-slate-300 rounded px-2.5 py-2 flex flex-col items-center justify-between text-center bg-white break-inside-avoid"
            >
              {config.showBusinessName && (
                <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-600 truncate w-full">
                  {businessName}
                </p>
              )}
              {config.showProductName && (
                <p className="text-[10px] font-bold text-slate-950 truncate w-full mt-0.5">
                  {label.productName}
                </p>
              )}
              <div className="w-full my-1">
                <BarcodeSvg
                  value={label.code}
                  symbology={config.symbology}
                  className={config.layout === 'a4_4col' ? 'w-full h-9' : 'w-full h-11'}
                />
              </div>
              {config.showCodeText && (
                <p className="text-[9px] font-mono tabular-nums text-slate-800 tracking-wider truncate w-full">
                  {encoded.displayValue}
                </p>
              )}
              {config.showPrice && (
                <p className="text-[11px] font-bold font-mono tabular-nums text-slate-950 mt-0.5">
                  {formatMoney(label.priceMinor, sym)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function downloadBarcodeLabelsPdf(params: {
  organization: Organization | null;
  items: BarcodeLabelItem[];
  config: BarcodeLabelConfig;
}): void {
  const { organization, items, config } = params;
  const labels = expandBarcodeLabels(items);
  if (labels.length === 0) return;

  const sym = organization?.currencySymbol || 'GH₵';
  const businessName = organization?.businessName || 'Multi-Branch POS System';

  if (config.layout === 'thermal_roll') {
    const labelW = 50;
    const labelH = 30;
    const doc = new jsPDF({ unit: 'mm', format: [labelW, labelH], orientation: 'landscape' });

    labels.forEach((label, idx) => {
      if (idx > 0) doc.addPage([labelW, labelH], 'landscape');
      const encoded = encodeBarcodeValue(label.code, config.symbology);
      const runs = getBarcodeBarRuns(encoded.modules);

      let y = 3.5;
      if (config.showBusinessName) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.5);
        doc.text(businessName.slice(0, 28), labelW / 2, y, { align: 'center' });
        y += 2.6;
      }
      if (config.showProductName) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.text(label.productName.slice(0, 26), labelW / 2, y, { align: 'center' });
        y += 2.5;
      }

      const barAreaW = labelW - 6;
      const barH = Math.max(8, 18 - (y - 3.5));
      const modW = barAreaW / Math.max(1, encoded.modules.length);
      doc.setFillColor(0, 0, 0);
      for (const run of runs) {
        doc.rect(3 + run.x * modW, y, Math.max(0.15, run.w * modW), barH, 'F');
      }
      y += barH + 2.8;

      if (config.showCodeText) {
        doc.setFont('courier', 'normal');
        doc.setFontSize(6);
        doc.text(encoded.displayValue.slice(0, 24), labelW / 2, y, { align: 'center' });
        y += 2.8;
      }
      if (config.showPrice) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(formatMoney(label.priceMinor, sym), labelW / 2, Math.min(labelH - 1.5, y), {
          align: 'center',
        });
      }
    });

    doc.save('barcode-labels-thermal.pdf');
    return;
  }

  const cols = config.layout === 'a4_4col' ? 4 : 3;
  const rowsPerPage = config.layout === 'a4_4col' ? 10 : 8;
  const perPage = cols * rowsPerPage;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 10;
  const marginY = 12;
  const gapX = 4;
  const gapY = 3.5;
  const cellW = (pageW - marginX * 2 - gapX * (cols - 1)) / cols;
  const cellH = (pageH - marginY * 2 - gapY * (rowsPerPage - 1)) / rowsPerPage;

  labels.forEach((label, idx) => {
    const pageIndex = Math.floor(idx / perPage);
    const indexOnPage = idx % perPage;
    if (idx > 0 && indexOnPage === 0) {
      doc.addPage('a4', 'portrait');
    }

    const col = indexOnPage % cols;
    const row = Math.floor(indexOnPage / cols);
    const x = marginX + col * (cellW + gapX);
    const y = marginY + row * (cellH + gapY);

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.rect(x, y, cellW, cellH);

    const encoded = encodeBarcodeValue(label.code, config.symbology);
    const runs = getBarcodeBarRuns(encoded.modules);

    let cursorY = y + 4;
    if (config.showBusinessName) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(71, 85, 105);
      doc.text(businessName.slice(0, cols === 4 ? 22 : 30), x + cellW / 2, cursorY, {
        align: 'center',
      });
      cursorY += 3;
    }
    if (config.showProductName) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(cols === 4 ? 6.8 : 7.8);
      doc.setTextColor(15, 23, 42);
      doc.text(label.productName.slice(0, cols === 4 ? 22 : 28), x + cellW / 2, cursorY, {
        align: 'center',
      });
      cursorY += 2.5;
    }

    const barMaxW = cellW - 8;
    const bottomReserved = (config.showCodeText ? 3.5 : 0) + (config.showPrice ? 4 : 0) + 2;
    const barH = Math.max(6, cellH - (cursorY - y) - bottomReserved);
    const modW = barMaxW / Math.max(1, encoded.modules.length);
    doc.setFillColor(0, 0, 0);
    for (const run of runs) {
      doc.rect(x + 4 + run.x * modW, cursorY, Math.max(0.15, run.w * modW), barH, 'F');
    }
    cursorY += barH + 3;

    if (config.showCodeText) {
      doc.setFont('courier', 'normal');
      doc.setFontSize(cols === 4 ? 6 : 6.8);
      doc.setTextColor(30, 41, 59);
      doc.text(encoded.displayValue.slice(0, 24), x + cellW / 2, cursorY, { align: 'center' });
      cursorY += 3.5;
    }
    if (config.showPrice) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(cols === 4 ? 7.5 : 8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(formatMoney(label.priceMinor, sym), x + cellW / 2, Math.min(y + cellH - 1.8, cursorY), {
        align: 'center',
      });
    }

    void pageIndex;
  });

  doc.save(`barcode-labels-${config.layout}.pdf`);
}
