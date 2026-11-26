import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ImagePlus,
  Save,
  Server,
  Settings as SettingsIcon,
  Trash2,
} from 'lucide-react';
import { BarcodePrintTab } from '../components/BarcodePrintTab';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { toMinorUnits } from '../lib/money';
import {
  DEFAULT_RECEIPT_VISIBLE_FIELDS,
  RECEIPT_FIELD_OPTIONS,
} from '../lib/receiptConfig';
import { sanitizeImageSrc } from '../lib/url';
import { apiRequest } from '../services/auditService';
import { updateOrganization, updateSystemSettings } from '../services/orgService';
import type { ReceiptFieldKey, SinglePaymentMethod, TaxDisplayMode } from '../types/pos';

interface ArchStage {
  stage: number;
  name: string;
  status: string;
}

export default function SettingsPage() {
  const { organization, systemSettings, hasPermission } = useAuth();
  const { notify } = useToast();

  const canManage = hasPermission('settings.manage');

  const [tab, setTab] = useState<'org' | 'pos' | 'barcode' | 'architecture'>('org');
  const [saving, setSaving] = useState(false);

  // Organization settings
  const [businessName, setBusinessName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoPreviewError, setLogoPreviewError] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [currency, setCurrency] = useState('GHS');
  const [currencySymbol, setCurrencySymbol] = useState('GH₵');
  const [taxRatePct, setTaxRatePct] = useState('15');
  const [taxLabel, setTaxLabel] = useState('VAT');
  const [allowNegativeInventory, setAllowNegativeInventory] = useState(false);

  // System / POS settings
  const [receiptHeader, setReceiptHeader] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [returnPolicy, setReturnPolicy] = useState('');
  const [receiptVisibleFields, setReceiptVisibleFields] = useState<ReceiptFieldKey[]>(
    DEFAULT_RECEIPT_VISIBLE_FIELDS
  );
  const [paymentMethods, setPaymentMethods] = useState<SinglePaymentMethod[]>([
    'cash',
    'mobile_money',
    'card',
    'bank_transfer',
  ]);
  const [maxCashierDiscountPct, setMaxCashierDiscountPct] = useState('10');
  const [expenseApprovalLimitStr, setExpenseApprovalLimitStr] = useState('500.00');
  const [refundWindowDays, setRefundWindowDays] = useState('7');
  const [lowStockNotificationsEnabled, setLowStockNotificationsEnabled] = useState(true);
  const [taxIncludedInPrice, setTaxIncludedInPrice] = useState(false);
  const [taxDisplayMode, setTaxDisplayMode] = useState<TaxDisplayMode>('amount');

  // Architecture status from Express backend
  const [archStages, setArchStages] = useState<ArchStage[]>([]);

  useEffect(() => {
    if (!organization) return;
    setBusinessName(organization.businessName);
    setRegistrationNumber(organization.registrationNumber || '');
    setLogoUrl(organization.logoUrl || '');
    setLogoPreviewError(false);
    setEmail(organization.email || '');
    setPhone(organization.phone || '');
    setAddress(organization.address || '');
    setCurrency(organization.currency);
    setCurrencySymbol(organization.currencySymbol);
    setTaxRatePct((organization.defaultTaxRateBps / 100).toString());
    setTaxLabel(organization.taxLabel || 'VAT');
    setAllowNegativeInventory(organization.allowNegativeInventory);
  }, [organization]);

  useEffect(() => {
    if (!systemSettings) return;
    setReceiptHeader(systemSettings.receiptHeader);
    setReceiptFooter(systemSettings.receiptFooter);
    setReturnPolicy(systemSettings.returnPolicy || '');
    setReceiptVisibleFields(
      systemSettings.receiptVisibleFields ?? DEFAULT_RECEIPT_VISIBLE_FIELDS
    );
    setPaymentMethods(systemSettings.supportedPaymentMethods);
    setMaxCashierDiscountPct(String(systemSettings.maxCashierDiscountPct));
    setExpenseApprovalLimitStr((systemSettings.expenseApprovalLimitMinor / 100).toFixed(2));
    setRefundWindowDays(String(systemSettings.refundWindowDays));
    setLowStockNotificationsEnabled(systemSettings.lowStockNotificationsEnabled);
    setTaxIncludedInPrice(Boolean(systemSettings.taxIncludedInPrice));
    setTaxDisplayMode(systemSettings.taxDisplayMode === 'percentage' ? 'percentage' : 'amount');
  }, [systemSettings]);

  useEffect(() => {
    if (tab !== 'architecture') return;
    apiRequest<{ architecture: { stages: ArchStage[] } }>('/api/system/architecture')
      .then((res) => setArchStages(res.architecture?.stages || []))
      .catch(() => {});
  }, [tab]);

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify('error', 'Unsupported Image Format', 'Please upload a PNG, JPEG, or WebP logo file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 220;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const targetW = Math.max(1, Math.round(img.width * scale));
        const targetH = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, targetW, targetH);

        let encoded = canvas.toDataURL('image/png');
        if (encoded.length > 60000) {
          encoded = canvas.toDataURL('image/webp', 0.85);
        }
        if (encoded.length > 60000) {
          encoded = canvas.toDataURL('image/jpeg', 0.82);
        }
        if (encoded.length > 64000) {
          notify(
            'error',
            'Logo Too Large',
            'Even after compression the image exceeds 64KB. Please choose a simpler logo image.'
          );
          return;
        }
        setLogoUrl(encoded);
        setLogoPreviewError(false);
        notify('info', 'Logo Ready', 'Click "Save Organization Settings" to publish your logo.');
      };
      img.onerror = () => {
        notify('error', 'Invalid Image', 'Could not decode the selected image file.');
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleSaveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !canManage) return;
    const taxBps = Math.max(0, Math.min(5000, Math.round(Number.parseFloat(taxRatePct || '0') * 100)));

    setSaving(true);
    try {
      await updateOrganization(organization.organizationId, {
        businessName: businessName.trim(),
        registrationNumber: registrationNumber.trim(),
        logoUrl: logoUrl.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        currency: currency.trim().toUpperCase(),
        currencySymbol: currencySymbol.trim(),
        defaultTaxRateBps: taxBps,
        taxLabel: taxLabel.trim() || 'VAT',
        allowNegativeInventory,
      });

      if (
        systemSettings &&
        (Boolean(systemSettings.taxIncludedInPrice) !== taxIncludedInPrice ||
          (systemSettings.taxDisplayMode || 'amount') !== taxDisplayMode)
      ) {
        await updateSystemSettings(systemSettings.settingId, organization.organizationId, {
          receiptHeader: receiptHeader.trim() || `${businessName.trim() || organization.businessName} Receipt`,
          receiptFooter: receiptFooter.trim() || 'Thank you for your business.',
          returnPolicy: returnPolicy.trim() || undefined,
          receiptVisibleFields,
          supportedPaymentMethods: paymentMethods,
          maxCashierDiscountPct: Math.max(0, Math.min(100, Number(maxCashierDiscountPct) || 0)),
          expenseApprovalLimitMinor: Math.max(0, toMinorUnits(expenseApprovalLimitStr)),
          refundWindowDays: Math.max(0, Math.min(365, Number(refundWindowDays) || 7)),
          lowStockNotificationsEnabled,
          taxIncludedInPrice,
          taxDisplayMode,
        });
      }

      notify('success', 'Organization Settings Saved', 'Logo, tax, currency, and inventory rules updated.');
    } catch (err) {
      notify('error', 'Save Failed', err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const toggleMethod = (method: SinglePaymentMethod) => {
    setPaymentMethods((prev) => {
      if (prev.includes(method)) {
        if (prev.length === 1) return prev;
        return prev.filter((m) => m !== method);
      }
      return [...prev, method];
    });
  };

  const toggleReceiptField = (fieldKey: ReceiptFieldKey) => {
    setReceiptVisibleFields((prev) =>
      prev.includes(fieldKey)
        ? prev.filter((k) => k !== fieldKey)
        : [...prev, fieldKey]
    );
  };

  const handleSavePosSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !systemSettings || !canManage) return;
    setSaving(true);
    try {
      await updateSystemSettings(systemSettings.settingId, organization.organizationId, {
        receiptHeader: receiptHeader.trim() || `${organization.businessName} Receipt`,
        receiptFooter: receiptFooter.trim() || 'Thank you for your business.',
        returnPolicy: returnPolicy.trim() || undefined,
        receiptVisibleFields,
        supportedPaymentMethods: paymentMethods,
        maxCashierDiscountPct: Math.max(0, Math.min(100, Number(maxCashierDiscountPct) || 0)),
        expenseApprovalLimitMinor: Math.max(0, toMinorUnits(expenseApprovalLimitStr)),
        refundWindowDays: Math.max(0, Math.min(365, Number(refundWindowDays) || 7)),
        lowStockNotificationsEnabled,
        taxIncludedInPrice,
        taxDisplayMode,
      });
      notify('success', 'System Policies Saved', 'Tax calculation mode, receipt templates, and limits updated.');
    } catch (err) {
      notify('error', 'Save Failed', err instanceof Error ? err.message : 'Unable to save policies.');
    } finally {
      setSaving(false);
    }
  };

  const safePreviewLogo = sanitizeImageSrc(logoUrl);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 font-display">System Settings</h2>
        <p className="text-sm text-slate-500">
          Manage organization profile, tax & currency rules, receipt policies, and deployment readiness.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setTab('org')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            tab === 'org'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-700'
          }`}
        >
          Organization & Tax
        </button>
        <button
          type="button"
          onClick={() => setTab('pos')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            tab === 'pos'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-700'
          }`}
        >
          Receipt, Payment & Limits
        </button>
        <button
          type="button"
          onClick={() => setTab('barcode')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            tab === 'barcode'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-700'
          }`}
        >
          Barcode Print Generation
        </button>
        <button
          type="button"
          onClick={() => setTab('architecture')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            tab === 'architecture'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-700'
          }`}
        >
          Architecture & Readiness
        </button>
      </div>

      {tab === 'org' && (
        <form
          onSubmit={(e) => void handleSaveOrg(e)}
          className="bg-white border border-slate-200 rounded-xl p-6 max-w-3xl space-y-4"
        >
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3 mb-2">
            <SettingsIcon className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">Business Identity, Logo &amp; Financial Rules</h3>
          </div>

          {/* Organization Logo Upload & URL */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-16 h-16 rounded-xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
              {safePreviewLogo && !logoPreviewError ? (
                <img
                  src={safePreviewLogo}
                  alt={businessName || 'Organization Logo'}
                  referrerPolicy="no-referrer"
                  onError={() => setLogoPreviewError(true)}
                  className="w-full h-full object-contain p-1"
                />
              ) : (
                <Building2 className="w-7 h-7 text-slate-400" />
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-slate-800">Organization Logo</p>
                  <p className="text-[11px] text-slate-500">
                    Displayed in the workspace sidebar, printed sales receipts, and EOD closing reports.
                  </p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                      <ImagePlus className="w-3.5 h-3.5 text-emerald-600" />
                      Upload Logo
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleLogoFileChange}
                        className="sr-only"
                      />
                    </label>
                    {logoUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setLogoUrl('');
                          setLogoPreviewError(false);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-medium text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
              <input
                type="text"
                disabled={!canManage}
                value={logoUrl.startsWith('data:') ? '' : logoUrl}
                onChange={(e) => {
                  setLogoUrl(e.target.value);
                  setLogoPreviewError(false);
                }}
                placeholder={
                  logoUrl.startsWith('data:')
                    ? 'Uploaded image ready (or paste an https:// image URL to replace)'
                    : 'Or paste a public https:// logo image URL...'
                }
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Business Name *
              </label>
              <input
                type="text"
                required
                disabled={!canManage}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Registration / TIN
              </label>
              <input
                type="text"
                disabled={!canManage}
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
              <input
                type="email"
                disabled={!canManage}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                disabled={!canManage}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Head Office Address
            </label>
            <input
              type="text"
              disabled={!canManage}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Currency Code</label>
              <input
                type="text"
                required
                disabled={!canManage}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Symbol</label>
              <input
                type="text"
                required
                disabled={!canManage}
                value={currencySymbol}
                onChange={(e) => setCurrencySymbol(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Rate (%)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="50"
                disabled={!canManage}
                value={taxRatePct}
                onChange={(e) => setTaxRatePct(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Label</label>
              <input
                type="text"
                disabled={!canManage}
                value={taxLabel}
                onChange={(e) => setTaxLabel(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
              />
            </div>
          </div>

          <div className="space-y-2.5 pt-2">
            <label className="flex items-start gap-2.5 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canManage}
                checked={taxIncludedInPrice}
                onChange={(e) => setTaxIncludedInPrice(e.target.checked)}
                className="mt-1 rounded border-slate-300 text-emerald-600"
              />
              <span>
                <span className="font-medium block">
                  Deduct tax from actual product price (Tax-Inclusive Pricing)
                </span>
                <span className="text-xs text-slate-500">
                  When checked, {taxLabel || 'VAT'} ({taxRatePct || '0'}%) is extracted from the product&apos;s selling price instead of added on top at checkout.
                </span>
              </span>
            </label>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
              <p className="text-xs font-semibold text-slate-800">
                Receipt &amp; Checkout Tax Display Format
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-200 bg-white text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="org-tax-display-mode"
                    disabled={!canManage}
                    checked={taxDisplayMode === 'amount'}
                    onChange={() => setTaxDisplayMode('amount')}
                    className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    <span className="font-semibold text-slate-900 block">
                      Display Tax Amount
                    </span>
                    <span className="text-[11px] text-slate-500">
                      e.g. {taxLabel || 'VAT'}: {currencySymbol || 'GH₵'}15.00
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-200 bg-white text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="org-tax-display-mode"
                    disabled={!canManage}
                    checked={taxDisplayMode === 'percentage'}
                    onChange={() => setTaxDisplayMode('percentage')}
                    className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    <span className="font-semibold text-slate-900 block">
                      Display Tax Rate Percentage Only
                    </span>
                    <span className="text-[11px] text-slate-500">
                      e.g. {taxLabel || 'VAT'}: {taxRatePct || '0'}%
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canManage}
                checked={allowNegativeInventory}
                onChange={(e) => setAllowNegativeInventory(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600"
              />
              <span>Allow Negative Inventory on POS Checkout (off by default to prevent overselling)</span>
            </label>
          </div>

          {canManage && (
            <div className="pt-3 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Organization Settings'}
              </button>
            </div>
          )}
        </form>
      )}

      {tab === 'pos' && (
        <form
          onSubmit={(e) => void handleSavePosSettings(e)}
          className="bg-white border border-slate-200 rounded-xl p-6 max-w-3xl space-y-4"
        >
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-3">
            Receipt Templates, Payment Methods & Approval Controls
          </h3>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Receipt Header
            </label>
            <input
              type="text"
              disabled={!canManage}
              value={receiptHeader}
              onChange={(e) => setReceiptHeader(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Receipt Footer
            </label>
            <input
              type="text"
              disabled={!canManage}
              value={receiptFooter}
              onChange={(e) => setReceiptFooter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Return & Refund Policy
            </label>
            <textarea
              rows={2}
              disabled={!canManage}
              value={returnPolicy}
              onChange={(e) => setReturnPolicy(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg disabled:bg-slate-50"
            />
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Records Shown on Order Receipt
                </label>
                <p className="text-[11px] text-slate-500">
                  Choose which details appear on printed thermal/A4 receipts and downloaded receipt PDFs.
                </p>
              </div>
              {canManage && (
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setReceiptVisibleFields(RECEIPT_FIELD_OPTIONS.map((o) => o.key))
                    }
                    className="px-2.5 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceiptVisibleFields(DEFAULT_RECEIPT_VISIBLE_FIELDS)}
                    className="px-2.5 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    Reset Default
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {RECEIPT_FIELD_OPTIONS.map((opt) => (
                <label
                  key={opt.key}
                  className="flex items-start gap-2.5 p-2.5 border border-slate-200 rounded-lg text-xs cursor-pointer hover:bg-slate-50/70"
                >
                  <input
                    type="checkbox"
                    disabled={!canManage}
                    checked={receiptVisibleFields.includes(opt.key)}
                    onChange={() => toggleReceiptField(opt.key)}
                    className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-800">{opt.label}</span>
                    <span className="block text-[11px] text-slate-500">{opt.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Supported Payment Methods
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  ['cash', 'Cash'],
                  ['mobile_money', 'Mobile Money'],
                  ['card', 'Card'],
                  ['bank_transfer', 'Bank Transfer'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2 p-2.5 border border-slate-200 rounded-lg text-sm"
                >
                  <input
                    type="checkbox"
                    disabled={!canManage}
                    checked={paymentMethods.includes(key)}
                    onChange={() => toggleMethod(key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Note: Mobile Money, Card, and Bank Transfer operate with manual terminal confirmation until live payment gateway credentials are configured.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Max Cashier Discount (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                disabled={!canManage}
                value={maxCashierDiscountPct}
                onChange={(e) => setMaxCashierDiscountPct(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Expense Approval Threshold ({organization?.currency})
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                disabled={!canManage}
                value={expenseApprovalLimitStr}
                onChange={(e) => setExpenseApprovalLimitStr(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Refund Window (Days)
              </label>
              <input
                type="number"
                min={0}
                max={365}
                disabled={!canManage}
                value={refundWindowDays}
                onChange={(e) => setRefundWindowDays(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono disabled:bg-slate-50"
              />
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50/70 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canManage}
                checked={taxIncludedInPrice}
                onChange={(e) => setTaxIncludedInPrice(e.target.checked)}
                className="mt-1 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>
                <span className="font-semibold text-slate-900 block text-xs">
                  Deduct Tax From Actual Product Price (Tax-Inclusive Mode)
                </span>
                <span className="block text-[11px] text-slate-600 mt-0.5">
                  Checked: product selling price already includes {taxLabel || 'VAT'} ({taxRatePct || '0'}%), so tax is deducted/extracted from that price without increasing the customer&apos;s total. Unchecked: tax is added on top of the product price.
                </span>
              </span>
            </label>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-900">
                Tax Display Mode on POS Checkout, Receipts &amp; Closing Reports
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-200 bg-white text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="pos-tax-display-mode"
                    disabled={!canManage}
                    checked={taxDisplayMode === 'amount'}
                    onChange={() => setTaxDisplayMode('amount')}
                    className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    <span className="font-semibold text-slate-900 block">
                      Show Tax Rate Amount
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Displays calculated currency amount ({currencySymbol || 'GH₵'}15.00)
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-200 bg-white text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="pos-tax-display-mode"
                    disabled={!canManage}
                    checked={taxDisplayMode === 'percentage'}
                    onChange={() => setTaxDisplayMode('percentage')}
                    className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    <span className="font-semibold text-slate-900 block">
                      Show Tax Rate Percentage Only
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Displays configured rate percentage ({taxRatePct || '0'}%)
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canManage}
                checked={lowStockNotificationsEnabled}
                onChange={(e) => setLowStockNotificationsEnabled(e.target.checked)}
              />
              <span>Emit Low-Stock Notifications Automatically on Checkout / Adjustments</span>
            </label>
          </div>

          {canManage && (
            <div className="pt-3 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save System Policies'}
              </button>
            </div>
          )}
        </form>
      )}

      {tab === 'barcode' && <BarcodePrintTab />}

      {tab === 'architecture' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-3xl space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
            <Server className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Multi-Stage Architecture & Deployment Readiness
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {archStages.map((s) => (
              <div key={s.stage} className="py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-sm font-medium text-slate-800">
                    Stage {s.stage}: {s.name}
                  </span>
                </div>
                <span className="text-xs font-mono font-semibold text-emerald-700 uppercase">
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
