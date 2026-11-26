import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, MailCheck, ShieldAlert, Store } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

export function LoginPage() {
  const {
    firebaseUser,
    userProfile,
    userRole,
    pendingInvitation,
    acceptPendingInvitation,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    logout,
  } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invitedEmailParam = (searchParams.get('email') || '').trim();
  const hasInviteLink = Boolean(searchParams.get('invite') || invitedEmailParam);

  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
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

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (authMode === 'signup') {
        await signUpWithEmail(email, password, fullName);
        notify(
          'success',
          'Account Created',
          'Continue to register your retail business and activate your 14-day trial.'
        );
      } else {
        await signInWithEmail(email, password);
      }
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
      } else if (code === 'auth/email-already-in-use') {
        message = 'An account with this email already exists. Switch to Sign In above.';
      } else if (code === 'auth/operation-not-allowed') {
        message = 'Email/Password sign-in must be enabled in Firebase Console by the project admin.';
      } else if (code === 'auth/too-many-requests') {
        message = 'Too many failed attempts. Wait a few minutes or reset your password.';
      }
      notify('error', authMode === 'signup' ? 'Registration Failed' : 'Sign-In Failed', message);
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
              Multi-Branch POS System
            </h1>
            <p className="text-xs text-slate-500">
              Multi-Tenant Retail Operations & Inventory SaaS Platform
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

        {/* Authenticated User Without Active Workspace Role: Register New Retail Business */}
        {firebaseUser &&
          !pendingInvitation &&
          userProfile?.accountStatus !== 'suspended' &&
          (!userProfile || !userRole) && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-3">
              <Store className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-950">
                  Start Your Retail Business Workspace
                </p>
                <p className="text-xs text-emerald-900 mt-1 leading-relaxed">
                  Signed in as <strong>{firebaseUser.email}</strong>. Launch a new multi-branch
                  retail workspace with a 14-day free trial, or sign out if you expected an
                  invitation from an existing store.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/setup')}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
            >
              Register New Retail Business
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="w-full py-2.5 px-4 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign Out & Try Another Account
            </button>
          </div>
        )}

        {/* Unauthenticated Sign-In / Sign-Up View */}
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
                  . Sign in using that email address below to activate your staff account.
                </p>
              </div>
            )}

            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleGoogleLogin()}
              className="w-full py-2.5 px-4 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-medium hover:bg-slate-50 transition-colors flex items-center justify-center gap-3 disabled:opacity-50"
            >
              <svg
                version="1.1"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 48 48"
                className="w-4 h-4 shrink-0"
                aria-hidden="true"
              >
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
                <path fill="none" d="M0 0h48v48H0z" />
              </svg>
              <span>{submitting ? 'Signing In...' : 'Sign in with Google'}</span>
            </button>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-slate-200" />
              <span className="shrink mx-3 text-xs text-slate-400">
                Or use email & password
              </span>
              <div className="flex-grow border-t border-slate-200" />
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg text-xs font-medium">
              <button
                type="button"
                onClick={() => setAuthMode('signin')}
                className={`py-1.5 rounded-md transition-colors ${
                  authMode === 'signin'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('signup')}
                className={`py-1.5 rounded-md transition-colors ${
                  authMode === 'signup'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Register Business
              </button>
            </div>

            <form onSubmit={(e) => void handleEmailAuth(e)} className="space-y-3.5">
              {authMode === 'signup' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Owner Full Name
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Kwame Mensah"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Work Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@company.com"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={authMode === 'signup' ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
                />
                {authMode === 'signin' && (
                  <div className="mt-1.5 flex justify-end">
                    <Link
                      to="/forgot-password"
                      className="text-xs text-emerald-700 hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg border border-slate-200 bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {authMode === 'signup'
                  ? 'Create Owner Account'
                  : 'Sign In with Email'}
              </button>
            </form>

            <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
              Invited staff sign in with their invited email to join an existing store. New retail
              owners can register a separate isolated tenant with a 14-day free trial.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
