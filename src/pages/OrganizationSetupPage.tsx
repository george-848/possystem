import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, CheckCircle2, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useEntitlements } from '../contexts/EntitlementContext';
import { useToast } from '../contexts/ToastContext';
import { getIncrementalPlanFeatures } from '../lib/entitlements';
import { formatMoney } from '../lib/money';
import { registerTenantBusiness } from '../services/saasService';

export function OrganizationSetupPage() {
  const { firebaseUser, userProfile, logout } = useAuth();
  const { plans } = useEntitlements();
  const { notify } = useToast();
  const navigate = useNavigate();

  const [businessName, setBusinessName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [email, setEmail] = useState(firebaseUser?.email || '');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [country, setCountry] = useState('Ghana');
  const [currency, setCurrency] = useState('GHS');
  const [currencySymbol, setCurrencySymbol] = useState('GH₵');
  const [timezone, setTimezone] = useState('Africa/Accra');
  const [taxRatePct, setTaxRatePct] = useState('15');
  const [taxLabel, setTaxLabel] = useState('VAT / NHIL');

  const [branchName, setBranchName] = useState('Head Office Flagship Store');
  const [branchCity, setBranchCity] = useState('Accra');
  const [branchRegion, setBranchRegion] = useState('Greater Accra');
  const [planId, setPlanId] = useState<'starter' | 'professional'>('starter');
  const [seedStarterCategories, setSeedStarterCategories] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const trialPlans = plans.filter(
    (p) => p.planId === 'starter' || p.planId === 'professional'
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const taxBps = Math.round(Number.parseFloat(taxRatePct || '0') * 100);
      await registerTenantBusiness({
        businessName,
        registrationNumber,
        email,
        phone,
        address,
        country,
        currency,
        currencySymbol,
        timezone,
        defaultTaxRateBps: Number.isFinite(taxBps) ? taxBps : 0,
        taxLabel,
        branchName,
        branchCity,
        branchRegion,
        branchAddress: address,
        branchPhone: phone,
        planId,
        seedStarterCategories,
      });
      notify(
        'success',
        'Business Workspace Created',
        'Tenant workspace, 14-day trial subscription, RBAC roles, and Branch BR-001 are ready.'
      );
      navigate('/dashboard');
    } catch (err) {
      notify(
        'error',
        'Setup Failed',
        err instanceof Error ? err.message : 'Unable to register retail business.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 font-display">
                Register Retail Business Workspace
              </h1>
              <p className="text-xs text-slate-500">
                Signed in as {firebaseUser?.email} · Provisions isolated tenant data, RBAC roles, POS-01, and 14-day free trial
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {userProfile && (
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Workspace
              </button>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
          {/* Plan Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-800 mb-2">
              Select Starting 14-Day Free Trial Package *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {trialPlans.map((plan) => {
                const selected = planId === plan.planId;
                const featureSummary = getIncrementalPlanFeatures(plan, trialPlans);
                return (
                  <button
                    key={plan.planId}
                    type="button"
                    onClick={() => setPlanId(plan.planId as 'starter' | 'professional')}
                    className={`text-left p-4 rounded-xl border transition-colors ${
                      selected
                        ? 'border-emerald-600 bg-emerald-50/50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900">{plan.name}</span>
                      <span className="text-xs font-mono font-semibold text-emerald-700">
                        {formatMoney(plan.monthlyPriceMinor, 'GH₵')}/mo after trial
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{plan.tagline}</p>
                    <p className="text-[11px] text-slate-500 mt-2 font-mono">
                      {plan.limits.maxBranches} branch{plan.limits.maxBranches === 1 ? '' : 'es'} ·{' '}
                      {plan.limits.maxTerminals} POS terminals · {plan.limits.maxStaff} staff
                    </p>
                    <div className="mt-2.5 pt-2 border-t border-slate-200/70 space-y-1">
                      {featureSummary.includedFromPlanName && (
                        <p className="text-[11px] font-semibold text-emerald-700">
                          All in {featureSummary.includedFromPlanName}
                          {featureSummary.additionalFeatures.length > 0 ? ', plus:' : ''}
                        </p>
                      )}
                      {featureSummary.additionalFeatures.map((feat) => (
                        <p key={feat.key} className="text-[11px] text-slate-600 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span>{feat.label}</span>
                        </p>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Business / Organization Name *
              </label>
              <input
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g., GoldCoast Retail Group Ltd"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Business Registration No.
              </label>
              <input
                type="text"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="CS123456789"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Official Contact Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Phone Number
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+233 30 200 0000"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Country
              </label>
              <input
                type="text"
                required
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Head Office Address
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Liberation Road, Airport Residential Area, Accra"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5 grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Currency Code *
              </label>
              <input
                type="text"
                required
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Symbol *
              </label>
              <input
                type="text"
                required
                value={currencySymbol}
                onChange={(e) => setCurrencySymbol(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Default Tax (%) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="50"
                required
                value={taxRatePct}
                onChange={(e) => setTaxRatePct(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono tabular-nums focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Timezone *
              </label>
              <input
                type="text"
                required
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Primary Branch Name (BR-001) *
              </label>
              <input
                type="text"
                required
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                City
              </label>
              <input
                type="text"
                value={branchCity}
                onChange={(e) => setBranchCity(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Region
              </label>
              <input
                type="text"
                value={branchRegion}
                onChange={(e) => setBranchRegion(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={seedStarterCategories}
              onChange={(e) => setSeedStarterCategories(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
            />
            Initialize standard retail product categories (Beverages, Groceries, Electronics, Personal Care, Household)
          </label>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {submitting ? 'Creating Workspace...' : 'Create Tenant & Start 14-Day Trial'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
