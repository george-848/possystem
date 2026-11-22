export type CsvCellValue = string | number | boolean | null | undefined;

export function sanitizeCsvCell(value: CsvCellValue): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvContent(headers: string[], rows: CsvCellValue[][]): string {
  const lines = [
    headers.map(sanitizeCsvCell).join(','),
    ...rows.map((row) => row.map(sanitizeCsvCell).join(',')),
  ];
  return lines.join('\r\n');
}

export function downloadCsvFile(
  filename: string,
  headers: string[],
  rows: CsvCellValue[][]
): void {
  const safeBase = filename.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/\.csv$/i, '') || 'export';
  const csv = buildCsvContent(headers, rows);
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeBase}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
