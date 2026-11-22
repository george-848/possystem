import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Search, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { downloadCsvFile } from '../lib/csv';
import { formatDateTime, getDateKey, timestampToDate } from '../lib/money';
import { downloadStructuredPdf } from '../lib/printPdf';

export default function AuditLogsPage() {
  const { organization, authorizedBranches } = useAuth();
  const { auditLogs } = useData();
  const { notify } = useToast();

  const [search, setSearch] = useState('');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const branchMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of authorizedBranches) map.set(b.branchId, `${b.branchCode} · ${b.branchName}`);
    return map;
  }, [authorizedBranches]);

  const resourceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const log of auditLogs) set.add(log.resourceType);
    return Array.from(set).sort();
  }, [auditLogs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const startMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const endMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    return auditLogs.filter((l) => {
      if (resourceFilter !== 'all' && l.resourceType !== resourceFilter) return false;
      if (branchFilter !== 'all' && l.branchId !== branchFilter) return false;

      if (startMs !== null || endMs !== null) {
        const logDate = timestampToDate(l.createdAt);
        const logMs = logDate.getTime();
        if (Number.isNaN(logMs) || logMs === 0) return false;
        if (startMs !== null && logMs < startMs) return false;
        if (endMs !== null && logMs > endMs) return false;
      }

      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        (l.userEmail || '').toLowerCase().includes(q) ||
        l.userId.toLowerCase().includes(q) ||
        l.resourceType.toLowerCase().includes(q) ||
        l.resourceId.toLowerCase().includes(q) ||
        (l.details || '').toLowerCase().includes(q)
      );
    });
  }, [auditLogs, search, resourceFilter, branchFilter, dateFrom, dateTo]);

  const hasActiveFilters =
    search.trim() !== '' ||
    resourceFilter !== 'all' ||
    branchFilter !== 'all' ||
    dateFrom !== '' ||
    dateTo !== '';

  const clearFilters = () => {
    setSearch('');
    setResourceFilter('all');
    setBranchFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const getBranchLabel = (branchId?: string) => {
    if (!branchId) return 'Organization';
    return branchMap.get(branchId) || branchId;
  };

  const buildFilterSummaryText = () => {
    const branchScope =
      branchFilter === 'all' ? 'All Branches' : branchMap.get(branchFilter) || branchFilter;
    const resourceScope =
      resourceFilter === 'all' ? 'All Resources' : resourceFilter;
    const dateScope =
      dateFrom || dateTo
        ? `${dateFrom || 'Start'} to ${dateTo || 'Present'}`
        : 'All Available Dates';
    const searchScope = search.trim() ? ` · Query: "${search.trim()}"` : '';
    return `Scope: ${branchScope} · Resource: ${resourceScope} · Period: ${dateScope}${searchScope}`;
  };

  const handleExportCsv = () => {
    if (filteredLogs.length === 0) {
      notify('info', 'Nothing to Export', 'No audit events match the current filters.');
      return;
    }

    const filename = `audit_logs_${getDateKey()}`;
    const headers = [
      'Log ID',
      'Timestamp',
      'Actor Email',
      'Actor User ID',
      'Action',
      'Resource Type',
      'Resource ID',
      'Branch',
      'Details',
    ];
    const rows = filteredLogs.map((log) => [
      log.logId,
      formatDateTime(log.createdAt),
      log.userEmail || '',
      log.userId,
      log.action,
      log.resourceType,
      log.resourceId,
      getBranchLabel(log.branchId),
      log.details || '',
    ]);

    downloadCsvFile(filename, headers, rows);
    notify(
      'success',
      'Audit CSV Exported',
      `Exported ${filteredLogs.length} filtered audit event(s) to ${filename}.csv.`
    );
  };

  const handleExportPdf = () => {
    if (filteredLogs.length === 0) {
      notify('info', 'Nothing to Export', 'No audit events match the current filters.');
      return;
    }

    const filename = `audit_logs_${getDateKey()}`;
    const branchScope =
      branchFilter === 'all' ? 'All Branches' : branchMap.get(branchFilter) || branchFilter;
    const resourceScope = resourceFilter === 'all' ? 'All Resources' : resourceFilter;
    const dateScope =
      dateFrom || dateTo
        ? `${dateFrom || 'Start'} - ${dateTo || 'Present'}`
        : 'All Dates';

    downloadStructuredPdf({
      title: 'Security & Compliance Audit Report',
      organizationName: organization?.businessName || 'Multi-Branch POS System',
      subtitle: buildFilterSummaryText(),
      filename,
      orientation: 'landscape',
      summaryItems: [
        { label: 'Exported Events', value: String(filteredLogs.length) },
        { label: 'Branch Scope', value: branchScope },
        { label: 'Resource Type', value: resourceScope },
        { label: 'Date Range', value: dateScope },
      ],
      headers: ['Timestamp', 'Actor', 'Action', 'Resource', 'Branch', 'Details'],
      columnWeights: [1.15, 1.35, 1.1, 1.3, 1.15, 2.55],
      wrapCells: true,
      rows: filteredLogs.map((log) => [
        formatDateTime(log.createdAt),
        log.userEmail || log.userId,
        log.action,
        `${log.resourceType}: ${log.resourceId}`,
        getBranchLabel(log.branchId),
        log.details || '—',
      ]),
      footerNote: 'Confidential — Internal Security & Compliance Audit Report',
    });

    notify(
      'success',
      'Audit PDF Downloaded',
      `Saved ${filteredLogs.length} filtered audit event(s) to ${filename}.pdf.`
    );
  };

  const visibleLogs = filteredLogs.slice(0, 200);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-display">Security & Audit Trail</h2>
          <p className="text-sm text-slate-500">
            Immutable chronological log of authentication events, checkout sales, stock movements, and RBAC changes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            title={`Export ${filteredLogs.length} filtered audit event(s) as CSV`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            title={`Export ${filteredLogs.length} filtered audit event(s) as PDF`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Export PDF
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search action, user email, resource ID, or event details..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            />
          </div>
          <select
            aria-label="Filter by resource type"
            value={resourceFilter}
            onChange={(e) => setResourceFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          >
            <option value="all">All Resource Types</option>
            {resourceTypes.map((rt) => (
              <option key={rt} value={rt}>
                {rt}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by branch"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          >
            <option value="all">All Branches</option>
            {authorizedBranches.map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {b.branchCode} — {b.branchName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <label className="inline-flex items-center gap-1.5">
              <span>From:</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white font-mono text-xs text-slate-800"
              />
            </label>
            <label className="inline-flex items-center gap-1.5">
              <span>To:</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white font-mono text-xs text-slate-800"
              />
            </label>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <X className="w-3 h-3" />
                Clear Filters
              </button>
            )}
          </div>

          <p className="text-xs text-slate-500 font-mono tabular-nums">
            {filteredLogs.length > visibleLogs.length
              ? `Showing ${visibleLogs.length} of ${filteredLogs.length} matching events (exports include all ${filteredLogs.length})`
              : `${filteredLogs.length} matching event(s)`}
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Resource</th>
                <th className="py-3 px-4">Branch</th>
                <th className="py-3 px-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {visibleLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    <FileSpreadsheet className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    No audit events match your filter.
                  </td>
                </tr>
              ) : (
                visibleLogs.map((log) => (
                  <tr key={log.logId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 text-xs font-mono text-slate-600 whitespace-nowrap tabular-nums">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <p className="font-medium text-slate-900">{log.userEmail || log.userId}</p>
                      <p className="font-mono text-slate-400">{log.userId.slice(0, 12)}...</p>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-emerald-700">
                      {log.action}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <span className="font-semibold text-slate-800">{log.resourceType}</span>
                      <span className="block font-mono text-slate-500">{log.resourceId}</span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {getBranchLabel(log.branchId)}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700 max-w-md">
                      {log.details || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
