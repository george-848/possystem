import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-2.5">
            {destructive && <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />}
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 p-1 rounded"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-slate-600 mb-6 leading-relaxed">{description}</p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
              destructive
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
