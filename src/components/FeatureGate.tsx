import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Lock, AlertTriangle } from 'lucide-react';
import { useEntitlements } from '../contexts/EntitlementContext';
import { FEATURE_CATALOG, getPlanById } from '../lib/entitlements';
import type { FeatureKey, QuotaResourceKey } from '../types/pos';

export function FeatureGate({
  feature,
  title,
  description,
  children,
}: {
  feature: FeatureKey;
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  const { checkFeature, entitlements, plans } = useEntitlements();
  const check = checkFeature(feature);

  if (check.allowed) {
    return <>{children}</>;
  }

  const featureDef = FEATURE_CATALOG.find((f) => f.key === feature);
  const minPlan = check.minimumPlan
    ? getPlanById(check.minimumPlan, plans)
    : undefined;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-xl mx-auto mt-8">
      <div className="w-11 h-11 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mb-4">
        <Lock className="w-5 h-5" />
      </div>
      <h2 className="text-lg font-bold text-slate-900 font-display">
        {title || featureDef?.label || 'Feature Upgrade Required'}
      </h2>
      <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
        {description || featureDef?.description}
      </p>
      <div className="mt-4 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
        <p>
          <strong>Current Plan:</strong> {entitlements.plan.name} (Status:{' '}
          <span className="capitalize">{entitlements.effectiveStatus.replace('_', ' ')}</span>)
        </p>
        {minPlan && (
          <p>
            <strong>Required Plan:</strong> {minPlan.name} or higher
          </p>
        )}
        {check.reason && <p className="text-amber-800 pt-1">{check.reason}</p>}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          to="/billing"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          Manage Plan & Upgrade
          <ArrowUpRight className="w-4 h-4" />
        </Link>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

export function QuotaStatusBar({
  resource,
  label,
}: {
  resource: QuotaResourceKey;
  label: string;
}) {
  const { entitlements } = useEntitlements();
  const q = entitlements.quotas[resource];
  const pct =
    q.effectiveCap && q.effectiveCap > 0
      ? Math.min(100, Math.round((q.used / q.effectiveCap) * 100))
      : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {q.atLimit && <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-slate-800">
              {label} Quota ({entitlements.plan.name})
            </span>
            <span className="font-mono tabular-nums text-slate-600">
              {q.limit === null
                ? `${q.used.toLocaleString()} active (Unlimited${
                    q.effectiveCap ? ` · Fair-use ${q.effectiveCap.toLocaleString()}` : ''
                  })`
                : `${q.used.toLocaleString()} / ${q.effectiveCap?.toLocaleString()}`}
            </span>
          </div>
          {q.limit !== null && (
            <div className="mt-1.5 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  q.exceeded
                    ? 'bg-rose-600'
                    : q.atLimit
                      ? 'bg-amber-500'
                      : 'bg-emerald-600'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {q.atLimit && (
        <Link
          to="/billing"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 shrink-0"
        >
          Upgrade Plan
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      )}
    </div>
  );
}
