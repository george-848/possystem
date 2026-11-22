import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let readable = error.message || 'An unexpected application error occurred.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; path?: string };
      if (parsed && parsed.error) {
        readable = `${parsed.error}${parsed.path ? ` (${parsed.path})` : ''}`;
      }
    } catch {
      // keep raw message
    }
    return { hasError: true, errorMessage: readable };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-8">
            <div className="flex items-center gap-3 text-rose-700 mb-3">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-semibold text-slate-900">
                Application Error Encountered
              </h1>
            </div>
            <p className="text-sm text-slate-600 mb-6 break-words">
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
