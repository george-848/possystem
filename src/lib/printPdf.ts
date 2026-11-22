import { jsPDF } from 'jspdf';

export interface StructuredPdfOptions {
  title: string;
  organizationName: string;
  subtitle?: string;
  filename: string;
  paperFormat?: 'a4' | 'letter';
  orientation?: 'portrait' | 'landscape';
  summaryItems?: Array<{ label: string; value: string }>;
  headers: string[];
  rows: Array<Array<string | number>>;
  columnWeights?: number[];
  wrapCells?: boolean;
  footerNote?: string;
}

export function downloadStructuredPdf(options: StructuredPdfOptions): void {
  const format = options.paperFormat || 'a4';
  const orientation = options.orientation || 'portrait';
  const doc = new jsPDF({ unit: 'pt', format, orientation });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  const usableWidth = pageWidth - margin * 2;
  let y = 44;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(`${options.organizationName} — ${options.title}`, margin, y);
  y += 16;

  if (options.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    const subLines = doc.splitTextToSize(options.subtitle, usableWidth);
    doc.text(subLines, margin, y);
    y += subLines.length * 12 + 6;
  } else {
    y += 4;
  }

  doc.setDrawColor(203, 213, 225);
  doc.line(margin, y, pageWidth - margin, y);
  y += 16;

  // Summary strip
  if (options.summaryItems && options.summaryItems.length > 0) {
    const cols = Math.min(4, options.summaryItems.length);
    const cardW = (usableWidth - (cols - 1) * 8) / cols;
    const cardH = 38;

    options.summaryItems.forEach((item, idx) => {
      const col = idx % cols;
      const rowIdx = Math.floor(idx / cols);
      const x = margin + col * (cardW + 8);
      const cy = y + rowIdx * (cardH + 8);

      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, cy, cardW, cardH, 4, 4, 'FD');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(item.label.slice(0, 28), x + 8, cy + 13);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text(item.value.slice(0, 28), x + 8, cy + 28);
    });

    const totalRows = Math.ceil(options.summaryItems.length / cols);
    y += totalRows * (cardH + 8) + 10;
  }

  const colCount = Math.max(1, options.headers.length);
  const weights =
    options.columnWeights && options.columnWeights.length === colCount
      ? options.columnWeights
      : Array.from({ length: colCount }, () => 1);
  const totalWeight = weights.reduce((sum, w) => sum + (w > 0 ? w : 1), 0);
  const colWidths = weights.map((w) => (usableWidth * (w > 0 ? w : 1)) / totalWeight);
  const colOffsets: number[] = [];
  let accX = margin;
  for (const w of colWidths) {
    colOffsets.push(accX);
    accX += w;
  }

  const baseRowHeight = 20;
  const lineHeight = 10.5;

  const drawTableHeader = () => {
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, y, usableWidth, baseRowHeight, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    options.headers.forEach((h, i) => {
      const cw = colWidths[i] || usableWidth / colCount;
      const text = String(h).slice(0, Math.max(8, Math.floor(cw / 5)));
      doc.text(text, colOffsets[i] + 6, y + 13);
    });
    y += baseRowHeight;
  };

  drawTableHeader();

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  if (options.rows.length === 0) {
    doc.setTextColor(100, 116, 139);
    doc.text('No records available for the selected filters.', margin + 6, y + 16);
    y += 28;
  } else {
    options.rows.forEach((row, rIdx) => {
      let wrappedCols: string[][] | null = null;
      let rowHeight = baseRowHeight;

      if (options.wrapCells) {
        wrappedCols = row.map((cell, cIdx) => {
          const cw = Math.max(24, (colWidths[cIdx] || usableWidth / colCount) - 10);
          const text = String(cell ?? '');
          const lines = doc.splitTextToSize(text, cw) as string[];
          return lines.length > 0 ? lines : [''];
        });
        const maxLines = Math.max(1, ...wrappedCols.map((lines) => lines.length));
        rowHeight = Math.max(baseRowHeight, maxLines * lineHeight + 9);
      }

      if (y + rowHeight > pageHeight - 48) {
        doc.addPage();
        y = 40;
        drawTableHeader();
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
      }

      if (rIdx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, usableWidth, rowHeight, 'F');
      }

      doc.setDrawColor(241, 245, 249);
      doc.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
      doc.setTextColor(15, 23, 42);

      if (wrappedCols) {
        wrappedCols.forEach((lines, cIdx) => {
          lines.forEach((line, lIdx) => {
            doc.text(line, colOffsets[cIdx] + 6, y + 13 + lIdx * lineHeight);
          });
        });
      } else {
        row.forEach((cell, cIdx) => {
          const cw = colWidths[cIdx] || usableWidth / colCount;
          const maxChars = Math.max(8, Math.floor(cw / 4.6));
          const val = String(cell ?? '').slice(0, maxChars);
          doc.text(val, colOffsets[cIdx] + 6, y + 13);
        });
      }
      y += rowHeight;
    });
  }

  if (options.footerNote) {
    if (y + 28 > pageHeight - 36) {
      doc.addPage();
      y = 44;
    }
    y += 14;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(options.footerNote.slice(0, 120), margin, y);
  }

  // Page numbering
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Generated ${new Date().toLocaleString()} · Page ${p} of ${pageCount}`,
      margin,
      pageHeight - 20
    );
  }

  doc.save(`${options.filename}.pdf`);
}
