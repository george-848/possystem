import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, Lock, LogIn, MailCheck, ShieldAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

export function LoginPage() {
  const {
    firebaseUser,
    userProfile,
    pendingInvitation,
    acceptPendingInvitation,
    signInWithGoogle,
    signInWithEmail,
    logout,
  } = useAuth();
  const { notify } = useToast();
  const [searchParams] = useSearchParams();
  const invitedEmailParam = (searchParams.get('email') || '').trim();
  const hasInviteLink = Boolean(searchParams.get('invite') || invitedEmailParam);

  const [email, setEmail] = useState(invitedEmailParam);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleGoogleLogin = async () => {
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      notify(
        'error',
        'Google Sign-In Failed',
        err instanceof Error ? err.message : 'Unable to authenticate with Google.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      let message =
        err instanceof Error ? err.message : 'Check your credentials or use Google Sign-In.';
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        message = 'Invalid work email or password. Ask your administrator if you need a reset.';
      } else if (code === 'auth/operation-not-allowed') {
        message = 'Email/Password sign-in must be enabled in Firebase Console by the project admin.';
      } else if (code === 'auth/too-many-requests') {
        message = 'Too many failed attempts. Wait a few minutes or reset your password.';
      }
      notify('error', 'Sign-In Failed', message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClaimInvitation = async () => {
    setSubmitting(true);
    try {
      await acceptPendingInvitation();
      notify('success', 'Account Activated', 'Your staff profile and branch permissions are active.');
    } catch (err) {
      notify(
        'error',
        'Invitation Claim Failed',
        err instanceof Error ? err.message : 'Unable to activate staff account.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 font-display">
              LedgerBranch POS
            </h1>
            <p className="text-xs text-slate-500">
              Enterprise Multi-Branch Retail & Inventory Platform
            </p>
          </div>
        </div>

        {/* Pending Staff Invitation Claim */}
        {firebaseUser && pendingInvitation && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200">
              <p className="text-sm font-semibold text-emerald-900">
                Staff Invitation Found
              </p>
              <p className="text-xs text-emerald-800 mt-1">
                You have been invited as <strong>{pendingInvitation.fullName}</strong> for{' '}
                {pendingInvitation.branchIds.length} branch(es). Activate your account to enter
                the POS workspace.
              </p>
            </div>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleClaimInvitation()}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Activating Account...' : 'Accept Invitation & Activate Account'}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="w-full py-2 px-4 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
            >
              Switch Account
            </button>
          </div>
        )}

        {/* Suspended Account Guard */}
        {firebaseUser && userProfile?.accountStatus === 'suspended' && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-rose-900">Account Suspended</p>
                <p className="text-xs text-rose-700 mt-1">
                  Your account ({userProfile.email}) has been suspended by an administrator.
                  Contact Head Office to restore access.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="w-full py-2.5 px-4 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign Out
            </button>
          </div>
        )}

        {/* Uninvited User Guard */}
        {firebaseUser && !userProfile && !pendingInvitation && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-3">
              <Lock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Administrator Invitation Required
                </p>
                <p className="text-xs text-amber-800 mt-1">
                  Public registration is disabled. No active staff profile or pending invitation
                  was found for <strong>{firebaseUser.email}</strong>. Ask your Super Admin or
                  Branch Administrator to invite this email address.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="w-full py-2.5 px-4 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign Out & Try Another Account
            </button>
          </div>
        )}

        {/* Unauthenticated Sign-In View */}
        {!firebaseUser && (
          <div className="space-y-5">
            {hasInviteLink && (
              <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2.5">
                <MailCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-900 leading-relaxed">
                  Staff invitation link detected
                  {invitedEmailParam ? (
                    <>
                      {' '}
                      for <strong className="font-mono">{invitedEmailParam}</strong>
                    </>
                  ) : null}
                  . Sign in with Google using that email address below to activate your account.
                </p>
              </div>
            )}
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleGoogleLogin()}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <LogIn className="w-4 h-4" />
              {submitting ? 'Signing In...' : 'Sign In with Google'}
            </button>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-slate-200" />
              <span className="shrink mx-3 text-xs text-slate-400">
                Or sign in with email
              </span>
              <div className="flex-grow border-t border-slate-200" />
            </div>

            <form onSubmit={(e) => void handleEmailLogin(e)} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Work Email
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
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Password
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-emerald-700 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg border border-slate-200 bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                Sign In with Email
              </button>
            </form>

            <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
              Access is controlled by organization administrators. Google Sign-In is enabled by
              default; Email/Password requires enabling the Email provider in Firebase Console.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
