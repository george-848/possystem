import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const { notify } = useToast();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
      notify('success', 'Reset Link Sent', 'Check your inbox for password reset instructions.');
    } catch (err) {
      notify(
        'error',
        'Reset Request Failed',
        err instanceof Error ? err.message : 'Could not send password reset email.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Sign In
        </Link>

        <h1 className="text-lg font-bold text-slate-900 font-display">
          Reset Account Password
        </h1>
        <p className="text-xs text-slate-500 mt-1 mb-6">
          Enter your registered staff email address to receive a Firebase password reset link.
        </p>

        {sent ? (
          <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-3">
            <MailCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-900">
              Password reset instructions have been dispatched to <strong>{email}</strong>.
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@company.com"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Sending Reset Link...' : 'Send Password Reset Email'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
