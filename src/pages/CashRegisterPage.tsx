import React, { useMemo, useState } from 'react';
import { CheckCircle2, Lock, Plus, Printer, Wallet } from 'lucide-react';
import { CashClosingReportModal } from '../components/CashClosingReportModal';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { formatDateTime, formatMoney, toMinorUnits } from '../lib/money';
import {
  approveCashSession,
  closeCashSession,
  openCashSession,
  recordCashMovement,
} from '../services/operationsService';
import type { CashSession } from '../types/pos';

export function CashRegisterPage() {
  const {
    userProfile,
    organization,
    systemSettings,
    activeBranchId,
    activeBranch,
    hasPermission,
  } = useAuth();
  const { cashSessions, sales, refunds } = useData();
  const { notify } = useToast();

  const [openingFloatStr, setOpeningFloatStr] = useState('0');
  const [closingCountStr, setClosingCountStr] = useState('');
  const [moveType, setMoveType] = useState<'deposit' | 'withdrawal'>('deposit');
  const [moveAmtStr, setMoveAmtStr] = useState('');
  const [moveNotes, setMoveNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [reportSession, setReportSession] = useState<CashSession | null>(null);

  const sym = organization?.currencySymbol || 'GH₵';
  const canOpen = hasPermission('cashSessions.open');
  const canClose = hasPermission('cashSessions.close');
  const canApprove = hasPermission('cashSessions.approve');

  const branchSessions = useMemo(
    () => cashSessions.filter((c) => c.branchId === activeBranchId),
    [cashSessions, activeBranchId]
  );

  const myOpenSession = useMemo(
    () =>
      branchSessions.find(
        (c) => c.cashierId === userProfile?.uid && c.status === 'open'
      ) || null,
    [branchSessions, userProfile]
  );

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !userProfile || !activeBranchId) return;
    setBusy(true);
    try {
      await openCashSession({
        organizationId: organization.organizationId,
        branchId: activeBranchId,
        cashierName: userProfile.fullName,
        openingBalanceMinor: toMinorUnits(openingFloatStr),
      });
      notify('success', 'Shift Opened', `Cash register opened at ${activeBranch?.branchName}.`);
      setOpeningFloatStr('0');
    } catch (err) {
      notify('error', 'Failed', err instanceof Error ? err.message : 'Unable to open shift');
    } finally {
      setBusy(false);
    }
  };

  const handleCashMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !activeBranchId || !myOpenSession) return;
    const amt = toMinorUnits(moveAmtStr);
    if (amt <= 0) return;
    setBusy(true);
    try {
      await recordCashMovement({
        sessionId: myOpenSession.sessionId,
        organizationId: organization.organizationId,
        branchId: activeBranchId,
        type: moveType,
        amountMinor: amt,
        notes: moveNotes,
      });
      notify('success', 'Cash Movement Recorded', `${moveType} of ${formatMoney(amt, sym)} saved.`);
      setMoveAmtStr('');
      setMoveNotes('');
    } catch (err) {
      notify('error', 'Failed', err instanceof Error ? err.message : 'Error recording movement');
    } finally {
      setBusy(false);
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !activeBranchId || !myOpenSession) return;
    setBusy(true);
    try {
      const actualMinor = toMinorUnits(closingCountStr);
      const closingSnapshotBase = { ...myOpenSession };
      const res = await closeCashSession({
        sessionId: myOpenSession.sessionId,
        organizationId: organization.organizationId,
        branchId: activeBranchId,
        actualClosingBalanceMinor: actualMinor,
      });
      notify(
        res.differenceMinor === 0 ? 'success' : 'info',
        'Shift Closed',
        `Variance: ${formatMoney(res.differenceMinor, sym)}`
      );
      setClosingCountStr('');
      setReportSession({
        ...closingSnapshotBase,
        actualClosingBalanceMinor: actualMinor,
        differenceMinor: res.differenceMinor,
        status: 'closed',
        closedAt: new Date(),
      });
    } catch (err) {
      notify('error', 'Close Failed', err instanceof Error ? err.message : 'Unable to close shift');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900 font-display">
          Cash Register & Cashier Shifts
        </h2>
        <p className="text-xs text-slate-500">
          Track opening floats, cash sales, refunds, drawer deposits/withdrawals, and shift sign-off
        </p>
      </div>

      {/* Active Shift Card */}
      {myOpenSession ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Active Open Shift — {myOpenSession.cashierName}
                </h3>
              </div>
              <span className="text-xs font-mono text-emerald-700 font-semibold">OPEN</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
              <div>
                <p className="text-xs text-slate-500">Opening Balance</p>
                <p className="text-base font-bold font-mono tabular-nums">
                  {formatMoney(myOpenSession.openingBalanceMinor, sym)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Cash Sales</p>
                <p className="text-base font-bold font-mono tabular-nums text-emerald-700">
                  +{formatMoney(myOpenSession.cashSalesMinor, sym)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Cash Refunds</p>
                <p className="text-base font-bold font-mono tabular-nums text-rose-700">
                  -{formatMoney(myOpenSession.cashRefundsMinor, sym)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Deposits</p>
                <p className="text-base font-bold font-mono tabular-nums">
                  +{formatMoney(myOpenSession.cashDepositsMinor, sym)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Withdrawals</p>
                <p className="text-base font-bold font-mono tabular-nums">
                  -{formatMoney(myOpenSession.cashWithdrawalsMinor, sym)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Expected Closing</p>
                <p className="text-base font-bold font-mono tabular-nums text-slate-900">
                  {formatMoney(myOpenSession.expectedClosingBalanceMinor, sym)}
                </p>
              </div>
            </div>

            {/* Deposit / Withdrawal Form */}
            <form
              onSubmit={(e) => void handleCashMovement(e)}
              className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-2"
            >
              <select
                value={moveType}
                onChange={(e) => setMoveType(e.target.value as 'deposit' | 'withdrawal')}
                className="sm:col-span-3 px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="deposit">Cash Deposit (+)</option>
                <option value="withdrawal">Cash Withdrawal (-)</option>
              </select>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={moveAmtStr}
                onChange={(e) => setMoveAmtStr(e.target.value)}
                placeholder={`Amount (${sym})`}
                className="sm:col-span-3 px-2.5 py-2 text-xs font-mono border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                value={moveNotes}
                onChange={(e) => setMoveNotes(e.target.value)}
                placeholder="Reason / Voucher ref"
                className="sm:col-span-4 px-2.5 py-2 text-xs border border-slate-200 rounded-lg"
              />
              <button
                type="submit"
                disabled={busy}
                className="sm:col-span-2 px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
              >
                Record
              </button>
            </form>
          </div>

          {canClose && (
            <form
              onSubmit={(e) => void handleCloseShift(e)}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-slate-700" />
                <h3 className="text-sm font-semibold text-slate-900">Close Cash Shift</h3>
              </div>
              <p className="text-xs text-slate-500">
                Count physical cash in the drawer. After closing, you can print the End-of-Day report.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Actual Counted Balance ({sym}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={closingCountStr}
                  onChange={(e) => setClosingCountStr(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy ? 'Closing...' : 'Submit Closing Count'}
              </button>
            </form>
          )}
        </div>
      ) : (
        canOpen && (
          <form
            onSubmit={(e) => void handleOpenShift(e)}
            className="bg-white border border-slate-200 rounded-xl p-6 max-w-md space-y-4"
          >
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                Open New Cash Register Shift
              </h3>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Opening Cash Float ({sym}) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={openingFloatStr}
                onChange={(e) => setOpeningFloatStr(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? 'Opening...' : 'Open Register Shift'}
            </button>
          </form>
        )
      )}

      {/* Session History Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Branch Cash Session History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">Cashier</th>
                <th className="text-left px-5 py-2.5 font-medium">Opened</th>
                <th className="text-right px-5 py-2.5 font-medium">Opening</th>
                <th className="text-right px-5 py-2.5 font-medium">Expected</th>
                <th className="text-right px-5 py-2.5 font-medium">Actual</th>
                <th className="text-right px-5 py-2.5 font-medium">Variance</th>
                <th className="text-left px-5 py-2.5 font-medium">Status</th>
                <th className="text-right px-5 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {branchSessions.map((cs) => (
                <tr key={cs.sessionId} className="hover:bg-slate-50">
                  <td className="px-5 py-3 text-xs font-semibold text-slate-900">
                    {cs.cashierName || cs.cashierId}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">
                    {formatDateTime(cs.openedAt)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs tabular-nums">
                    {formatMoney(cs.openingBalanceMinor, sym)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs tabular-nums">
                    {formatMoney(cs.expectedClosingBalanceMinor, sym)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs tabular-nums">
                    {cs.actualClosingBalanceMinor !== undefined
                      ? formatMoney(cs.actualClosingBalanceMinor, sym)
                      : '—'}
                  </td>
                  <td
                    className={`px-5 py-3 text-right font-mono text-xs tabular-nums font-semibold ${
                      (cs.differenceMinor || 0) === 0 ? 'text-slate-600' : 'text-rose-700'
                    }`}
                  >
                    {cs.differenceMinor !== undefined
                      ? formatMoney(cs.differenceMinor, sym)
                      : '—'}
                  </td>
                  <td className="px-5 py-3 text-xs capitalize font-medium text-slate-700">
                    {cs.status}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {(cs.status === 'closed' || cs.status === 'approved') && (
                        <button
                          type="button"
                          onClick={() => setReportSession(cs)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                        >
                          <Printer className="w-3 h-3" />
                          Print EOD
                        </button>
                      )}
                      {cs.status === 'closed' && canApprove ? (
                        <button
                          type="button"
                          onClick={() =>
                            void approveCashSession(
                              cs.sessionId,
                              cs.organizationId,
                              cs.branchId
                            ).then(() =>
                              notify('success', 'Shift Approved', 'Cash session signed off.')
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Approve
                        </button>
                      ) : cs.status === 'approved' ? (
                        <span className="text-xs text-slate-400">Approved</span>
                      ) : cs.status === 'open' ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {branchSessions.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-xs text-slate-500">
                    No cash register sessions opened for this branch yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CashClosingReportModal
        open={Boolean(reportSession)}
        onClose={() => setReportSession(null)}
        session={reportSession}
        organization={organization}
        branch={activeBranch}
        settings={systemSettings}
        sales={sales}
        refunds={refunds}
      />
    </div>
  );
}
