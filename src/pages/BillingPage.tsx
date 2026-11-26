import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Crown,
  ExternalLink,
  HelpCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { QuotaStatusBar } from '../components/FeatureGate';
import { useAuth } from '../contexts/AuthContext';
import { useEntitlements } from '../contexts/EntitlementContext';
import { useToast } from '../contexts/ToastContext';
import {
  evaluatePlanChangeCompatibility,
  getIncrementalPlanFeatures,
  getPlanPriceMinor,
} from '../lib/entitlements';
import { formatDateTime, formatMoney } from '../lib/money';
import { sanitizeHttpUrl } from '../lib/url';
import {
  fetchTenantBillingHistory,
  initializeSubscriptionCheckout,
  requestSubscriptionPlanChange,
  submitSupportTicket,
  verifySubscriptionPayment,
} from '../services/billingService';
import type {
  BillingCycle,
  SubscriptionPayment,
  SubscriptionPlan,
  SupportTicket,
} from '../types/pos';

export default function BillingPage() {
  const { organization, hasPermission } = useAuth();
  const {
    plans,
    subscription,
    entitlements,
    featureOverrides,
    paystackConfigured: envPaystackConfigured,
  } = useEntitlements();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const canManageBilling = hasPermission('settings.manage');

  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    entitlements.billingCycle || 'monthly'
  );
  const [channel, setChannel] = useState<'mobile_money' | 'card' | 'bank_transfer'>(
    'mobile_money'
  );
  const [momoNetwork, setMomoNetwork] = useState<'mtn' | 'telecel' | 'airteltigo'>('mtn');
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [paystackReady, setPaystackReady] = useState(envPaystackConfigured);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);
  const [verifyRefInput, setVerifyRefInput] = useState('');
  const [verifyingRef, setVerifyingRef] = useState(false);
  const [pendingCheckoutUrl, setPendingCheckoutUrl] = useState<{
    url: string;
    reference: string;
    planName: string;
  } | null>(null);

  // Support ticket form
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketCategory, setTicketCategory] = useState<
    'billing' | 'technical' | 'entitlements' | 'onboarding' | 'other'
  >('billing');
  const [ticketPriority, setTicketPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>(
    'medium'
  );
  const [ticketMessage, setTicketMessage] = useState('');
  const [submittingTicket, setSubmittingTicket] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!organization) return;
    setLoadingHistory(true);
    try {
      const res = await fetchTenantBillingHistory(organization.organizationId);
      setPayments(Array.isArray(res?.payments) ? res.payments : []);
      setTickets(Array.isArray(res?.tickets) ? res.tickets : []);
      setPaystackReady(Boolean(res?.paystackConfigured) || envPaystackConfigured);
    } finally {
      setLoadingHistory(false);
    }
  }, [organization, envPaystackConfigured]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Verify Paystack callback reference automatically if present in query params
  useEffect(() => {
    const ref = searchParams.get('reference') || searchParams.get('trxref');
    if (!ref || !organization || !canManageBilling) return;
    setVerifyRefInput(ref);
    setVerifyingRef(true);
    void verifySubscriptionPayment({
      organizationId: organization.organizationId,
      reference: ref,
    })
      .then((res) => {
        if (res.verified) {
          notify(
            'success',
            'Payment Verified',
            `Subscription activated on ${res.planId || 'selected plan'}.`
          );
          setSearchParams({}, { replace: true });
          void loadHistory();
        }
      })
      .catch((err) => {
        notify('error', 'Verification Pending', err instanceof Error ? err.message : 'Verify failed');
      })
      .finally(() => setVerifyingRef(false));
  }, [searchParams, organization, canManageBilling, notify, setSearchParams, loadHistory]);

  const handleSelectPlan = async (plan: SubscriptionPlan) => {
    if (!organization || !canManageBilling) return;

    const compat = evaluatePlanChangeCompatibility({
      targetPlan: plan,
      usage: entitlements.usage,
    });
    if (!compat.compatible) {
      notify('error', 'Plan Limit Exceeded', compat.warnings[0]);
      return;
    }

    setProcessingPlanId(plan.planId);
    try {
      // Enterprise or zero-amount custom pricing -> create onboarding/upgrade inquiry
      if (plan.isCustomPricing && getPlanPriceMinor(plan, billingCycle) <= 0) {
        setTicketCategory('billing');
        setTicketSubject(`Enterprise Plan Inquiry — ${organization.businessName}`);
        setTicketMessage(
          `Requesting Enterprise plan activation for ${organization.businessName} (${billingCycle}).`
        );
        notify(
          'info',
          'Enterprise Custom Plan',
          'Complete the support inquiry below for custom Enterprise provisioning.'
        );
        return;
      }

      // If switching during free trial (Starter <-> Pro) or downgrading an active paid plan
      if (
        (entitlements.inTrial && plan.sortOrder <= 2) ||
        (entitlements.effectiveStatus === 'active' && plan.sortOrder < entitlements.plan.sortOrder)
      ) {
        const res = await requestSubscriptionPlanChange({
          organizationId: organization.organizationId,
          targetPlanId: plan.planId,
          targetBillingCycle: billingCycle,
          immediate: false,
        });
        if (res.scheduledForPeriodEnd) {
          notify(
            'info',
            'Downgrade Scheduled',
            `${plan.name} will take effect at the end of your current billing period.`
          );
          return;
        }
        if (res.changed) {
          notify('success', 'Plan Updated', `Switched to ${plan.name} (${billingCycle}).`);
          return;
        }
      }

      // Otherwise initialize authoritative Paystack checkout (Card / Ghanaian MoMo)
      const checkout = await initializeSubscriptionCheckout({
        organizationId: organization.organizationId,
        planId: plan.planId,
        billingCycle,
        channel,
        mobileMoneyNetwork: channel === 'mobile_money' ? momoNetwork : undefined,
        callbackUrl: `${window.location.origin}/billing`,
      });

      const safeCheckoutUrl = sanitizeHttpUrl(checkout.authorizationUrl, { httpsOnly: true });
      if (!safeCheckoutUrl) {
        throw new Error('Payment provider returned an invalid checkout URL.');
      }

      setVerifyRefInput(checkout.reference);
      setPendingCheckoutUrl({
        url: safeCheckoutUrl,
        reference: checkout.reference,
        planName: plan.name,
      });
      notify(
        'success',
        'Paystack Checkout Ready',
        `Reference ${checkout.reference} created. Open the Paystack window to authorize payment.`
      );
      void loadHistory();
    } catch (err) {
      notify(
        'error',
        'Plan Action Failed',
        err instanceof Error ? err.message : 'Unable to process plan change.'
      );
    } finally {
      setProcessingPlanId(null);
    }
  };

  const handleManualVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !verifyRefInput.trim()) return;
    setVerifyingRef(true);
    try {
      const res = await verifySubscriptionPayment({
        organizationId: organization.organizationId,
        reference: verifyRefInput.trim(),
      });
      if (res.verified) {
        notify('success', 'Payment Verified', 'Subscription updated and active.');
        setPendingCheckoutUrl(null);
        void loadHistory();
      }
    } catch (err) {
      notify(
        'error',
        'Verification Failed',
        err instanceof Error ? err.message : 'Unable to verify reference.'
      );
    } finally {
      setVerifyingRef(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !ticketSubject.trim() || !ticketMessage.trim()) return;
    setSubmittingTicket(true);
    try {
      await submitSupportTicket({
        organizationId: organization.organizationId,
        tenantName: organization.businessName,
        subject: ticketSubject.trim(),
        category: ticketCategory,
        priority: ticketPriority,
        message: ticketMessage.trim(),
      });
      setTicketSubject('');
      setTicketMessage('');
      notify('success', 'Support Ticket Submitted', 'Platform support has received your request.');
      void loadHistory();
    } catch (err) {
      notify(
        'error',
        'Submission Failed',
        err instanceof Error ? err.message : 'Unable to send ticket.'
      );
    } finally {
      setSubmittingTicket(false);
    }
  };

  const safePayments = Array.isArray(payments) ? payments : [];
  const safeTickets = Array.isArray(tickets) ? tickets : [];
  const safeOverrides = Array.isArray(featureOverrides) ? featureOverrides : [];
  const activePlans = (Array.isArray(plans) ? plans : []).filter((p) => p.status !== 'archived');

  return (
    <div className="space-y-6">
      {/* Header & Current Subscription Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 font-display">
                Subscription Plan &amp; Billing
              </h2>
              <p className="text-xs text-slate-500">
                Manage entitlements, branch &amp; terminal quotas, Paystack &amp; Ghana Mobile Money renewals.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="px-4 py-2.5 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-slate-500">Active Plan</p>
            <p className="text-sm font-bold text-slate-900">
              {entitlements.plan.name}{' '}
              <span className="font-normal text-slate-500 capitalize">
                ({entitlements.billingCycle})
              </span>
            </p>
          </div>
          <div className="px-4 py-2.5 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-slate-500">Subscription Status</p>
            <p
              className={`text-sm font-bold capitalize ${
                entitlements.effectiveStatus === 'active' || entitlements.effectiveStatus === 'trial'
                  ? 'text-emerald-700'
                  : entitlements.effectiveStatus === 'grace_period'
                    ? 'text-amber-700'
                    : 'text-rose-700'
              }`}
            >
              {entitlements.effectiveStatus.replace('_', ' ')}
              {entitlements.daysRemaining !== null && entitlements.daysRemaining > 0
                ? ` · ${entitlements.daysRemaining}d left`
                : ''}
              {entitlements.inGracePeriod && entitlements.graceDaysRemaining !== null
                ? ` · ${entitlements.graceDaysRemaining}d grace left`
                : ''}
            </p>
          </div>
          {subscription?.pendingPlanId && (
            <div className="px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
              <p className="font-semibold">Scheduled Change</p>
              <p className="capitalize">
                Switches to {subscription.pendingPlanId.replace('_', ' ')} at period end
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Quota Utilization Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <QuotaStatusBar resource="branches" label="Retail Branches" />
        <QuotaStatusBar resource="terminals" label="POS Counter Terminals" />
        <QuotaStatusBar resource="staff" label="Staff Accounts" />
        <QuotaStatusBar resource="products" label="Catalog SKUs" />
      </div>

      {/* Active Temporary Overrides */}
      {safeOverrides.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          <div className="text-xs text-emerald-950 space-y-1">
            <p className="font-semibold">Active Platform Entitlement Overrides</p>
            {safeOverrides.map((ov) => (
              <p key={ov.overrideId}>
                • {ov.featureKey ? `Feature "${ov.featureKey}" (${ov.enabled ? 'Enabled' : 'Disabled'})` : 'Custom quota override'} — {ov.reason} (expires{' '}
                {(ov.expiresAt || '').slice(0, 10)})
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Paystack Checkout Options & Verification Box */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-slate-700">Billing Cycle:</span>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
              <button
                type="button"
                onClick={() => setBillingCycle('monthly')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                  billingCycle === 'monthly'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle('annual')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                  billingCycle === 'annual'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Annual (2 Months Free)
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-slate-700">Payment Channel:</span>
            <select
              value={channel}
              onChange={(e) =>
                setChannel(e.target.value as 'mobile_money' | 'card' | 'bank_transfer')
              }
              className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg bg-white"
            >
              <option value="mobile_money">Ghana Mobile Money (MoMo / Telecel / AT)</option>
              <option value="card">Visa / Mastercard (Paystack)</option>
              <option value="bank_transfer">Bank Transfer</option>
            </select>
            {channel === 'mobile_money' && (
              <select
                value={momoNetwork}
                onChange={(e) => setMomoNetwork(e.target.value as 'mtn' | 'telecel' | 'airteltigo')}
                className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg bg-white"
              >
                <option value="mtn">MTN Mobile Money</option>
                <option value="telecel">Telecel Cash</option>
                <option value="airteltigo">AT Money</option>
              </select>
            )}
          </div>
        </div>

        {!paystackReady && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Paystack gateway secret (`PAYSTACK_SECRET_KEY`) is not configured on this environment yet. Paid upgrades are blocked from frontend bypass; contact your Platform Admin or set server keys.
            </span>
          </div>
        )}

        {pendingCheckoutUrl && (
          <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-emerald-950">
              <p className="font-bold">
                Checkout initialized for {pendingCheckoutUrl.planName} ({pendingCheckoutUrl.reference})
              </p>
              <p className="text-emerald-800 mt-0.5">
                Complete authorization on Paystack, then click Verify Payment Reference below (or wait for webhook confirmation).
              </p>
            </div>
            <a
              href={pendingCheckoutUrl.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shrink-0"
            >
              <Smartphone className="w-3.5 h-3.5" />
              Authorize on Paystack
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        <form onSubmit={(e) => void handleManualVerify(e)} className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <input
            type="text"
            value={verifyRefInput}
            onChange={(e) => setVerifyRefInput(e.target.value)}
            placeholder="Enter Paystack payment reference to verify..."
            className="flex-1 min-w-[220px] px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
          />
          <button
            type="submit"
            disabled={verifyingRef || !verifyRefInput.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {verifyingRef ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Verify Payment Reference
          </button>
        </form>
      </div>

      {/* Plan Comparison Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {activePlans.map((plan) => {
          const isCurrent = entitlements.plan.planId === plan.planId;
          const priceMinor = getPlanPriceMinor(plan, billingCycle);
          const compat = evaluatePlanChangeCompatibility({
            targetPlan: plan,
            usage: entitlements.usage,
          });
          const isBusy = processingPlanId === plan.planId;

          return (
            <div
              key={plan.planId}
              className={`bg-white rounded-xl p-5 flex flex-col justify-between gap-4 border ${
                isCurrent ? 'border-emerald-600 ring-1 ring-emerald-600' : 'border-slate-200'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 font-display">{plan.name}</h3>
                    <p className="text-xs text-slate-500">{plan.tagline}</p>
                  </div>
                  {isCurrent && (
                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                      Current
                    </span>
                  )}
                </div>

                <div>
                  <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                    {formatMoney(priceMinor, 'GH₵')}
                    <span className="text-xs font-sans font-normal text-slate-500">
                      /{billingCycle === 'annual' ? 'yr' : 'mo'}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{plan.description}</p>
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-1 text-xs text-slate-700 font-mono">
                  <p>
                    Branches: <strong>{plan.limits.maxBranches ?? 'Custom / Unlimited'}</strong>
                  </p>
                  <p>
                    POS Terminals: <strong>{plan.limits.maxTerminals ?? 'Custom / Unlimited'}</strong>
                  </p>
                  <p>
                    Staff Accounts: <strong>{plan.limits.maxStaff ?? 'Custom / Unlimited'}</strong>
                  </p>
                  <p>
                    Products:{' '}
                    <strong>
                      {plan.limits.maxProducts ??
                        `Unlimited (${plan.limits.fairUseProductCap?.toLocaleString() || '50k'} fair-use)`}
                    </strong>
                  </p>
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-1.5">
                  {(() => {
                    const summary = getIncrementalPlanFeatures(plan, activePlans);
                    return (
                      <>
                        {summary.includedFromPlanName && (
                          <p className="text-xs font-semibold text-emerald-700">
                            All in {summary.includedFromPlanName}
                            {summary.additionalFeatures.length > 0 ? ', plus:' : ''}
                          </p>
                        )}
                        {summary.additionalFeatures.map((f) => (
                          <p key={f.key} className="text-xs text-slate-700 flex items-start gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                            <span>{f.label}</span>
                          </p>
                        ))}
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="pt-2 space-y-2">
                {!compat.compatible && (
                  <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                    {compat.warnings[0]}
                  </p>
                )}
                <button
                  type="button"
                  disabled={!canManageBilling || isBusy || !compat.compatible}
                  onClick={() => void handleSelectPlan(plan)}
                  className={`w-full py-2.5 px-4 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                    isCurrent
                      ? 'bg-slate-900 hover:bg-slate-800 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                >
                  {isBusy
                    ? 'Processing...'
                    : isCurrent
                      ? 'Renew Current Plan'
                      : plan.sortOrder > entitlements.plan.sortOrder
                        ? `Upgrade to ${plan.name}`
                        : `Switch to ${plan.name}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Payments Ledger & Support Desk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment History */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-700" />
              <h3 className="text-sm font-semibold text-slate-900">Subscription Payment History</h3>
            </div>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2.5 px-4">Reference</th>
                  <th className="py-2.5 px-4">Plan</th>
                  <th className="py-2.5 px-4">Channel</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {safePayments.map((pay) => (
                  <tr key={pay.paymentId}>
                    <td className="py-2.5 px-4 font-mono text-slate-800">
                      <div>{pay.reference}</div>
                      <div className="text-[10px] text-slate-400">
                        {formatDateTime(pay.createdAt)}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 capitalize">
                      {pay.planId.replace('_', ' ')} ({pay.billingCycle})
                    </td>
                    <td className="py-2.5 px-4 uppercase font-mono">
                      {pay.channel.replace('_', ' ')}
                      {pay.mobileMoneyNetwork ? ` · ${pay.mobileMoneyNetwork}` : ''}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                      {formatMoney(pay.amountMinor, 'GH₵')}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`font-semibold capitalize ${
                          pay.status === 'succeeded'
                            ? 'text-emerald-700'
                            : pay.status === 'failed'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {pay.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {safePayments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      No subscription payments recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Support Tickets */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-emerald-700" />
              <h3 className="text-sm font-semibold text-slate-900">
                Platform Support &amp; Custom Plan Requests
              </h3>
            </div>
            {entitlements.features.priority_support && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                <ShieldCheck className="w-3.5 h-3.5" /> Priority SLA
              </span>
            )}
          </div>

          <form onSubmit={(e) => void handleCreateTicket(e)} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                value={ticketCategory}
                onChange={(e) =>
                  setTicketCategory(
                    e.target.value as 'billing' | 'technical' | 'entitlements' | 'onboarding' | 'other'
                  )
                }
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="billing">Billing &amp; Renewals</option>
                <option value="entitlements">Plan Quotas &amp; Upgrades</option>
                <option value="technical">Technical Support</option>
                <option value="onboarding">Dedicated Deployment / Onboarding</option>
                <option value="other">Other</option>
              </select>
              <select
                value={ticketPriority}
                onChange={(e) =>
                  setTicketPriority(e.target.value as 'low' | 'medium' | 'high' | 'urgent')
                }
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <input
              type="text"
              required
              value={ticketSubject}
              onChange={(e) => setTicketSubject(e.target.value)}
              placeholder="Ticket subject..."
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
            />
            <textarea
              rows={3}
              required
              value={ticketMessage}
              onChange={(e) => setTicketMessage(e.target.value)}
              placeholder="Describe your billing, quota, or deployment request..."
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submittingTicket}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
              >
                {submittingTicket ? 'Submitting...' : 'Open Support Ticket'}
              </button>
            </div>
          </form>

          {safeTickets.length > 0 && (
            <div className="border-t border-slate-100 pt-3 space-y-2 max-h-48 overflow-y-auto">
              {safeTickets.map((t) => (
                <div
                  key={t.ticketId}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{t.subject}</span>
                    <span className="capitalize font-semibold text-emerald-700">
                      {t.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-slate-600 mt-1">{t.message}</p>
                  {t.adminNotes && (
                    <p className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2 mt-2">
                      <strong>Platform Reply:</strong> {t.adminNotes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
