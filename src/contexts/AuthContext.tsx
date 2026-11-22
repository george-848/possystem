import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  canAccessBranch as checkBranchAccess,
  hasUserPermission,
  resolveEffectivePermissions,
} from '../lib/permissions';
import { apiRequest } from '../services/auditService';
import {
  claimInvitationForCurrentUser,
  recordUserLastLogin,
} from '../services/rbacService';
import type {
  Branch,
  Invitation,
  Organization,
  Role,
  SystemSettings,
  UserProfile,
} from '../types/pos';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  authReady: boolean;
  loadingProfile: boolean;
  userProfile: UserProfile | null;
  userRole: Role | null;
  organization: Organization | null;
  systemSettings: SystemSettings | null;
  branches: Branch[];
  authorizedBranches: Branch[];
  activeBranchId: string;
  activeBranch: Branch | null;
  setActiveBranchId: (branchId: string) => Promise<void>;
  pendingInvitation: Invitation | null;
  needsOrgSetup: boolean;
  isBootstrapEmail: boolean;
  isSuperAdmin: boolean;
  effectivePermissions: Set<string>;
  hasPermission: (perm: string) => boolean;
  canAccessBranch: (branchId: string) => boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  acceptPendingInvitation: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const BOOTSTRAP_EMAIL = 'appiahkubi848@gmail.com';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchState] = useState<string>('');
  const [pendingInvitation, setPendingInvitation] = useState<Invitation | null>(null);
  const [needsOrgSetup, setNeedsOrgSetup] = useState(false);
  const [loginLoggedUid, setLoginLoggedUid] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setUserProfile(null);
        setUserRole(null);
        setOrganization(null);
        setSystemSettings(null);
        setBranches([]);
        setActiveBranchState('');
        setPendingInvitation(null);
        setNeedsOrgSetup(false);
        setLoadingProfile(false);
        setLoginLoggedUid(null);
        return;
      }
      setLoadingProfile(true);
      void apiRequest('/api/auth/verify', { method: 'POST' }).catch(() => {});
    });
    return () => unsub();
  }, []);

  // Listen to user profile document
  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    const path = `users/${firebaseUser.uid}`;
    const unsub = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      async (snap) => {
        if (snap.exists()) {
          const profile = snap.data() as UserProfile;
          setUserProfile(profile);
          setPendingInvitation(null);
          setNeedsOrgSetup(false);
          setLoadingProfile(false);

          if (profile.accountStatus === 'active' && loginLoggedUid !== profile.uid) {
            setLoginLoggedUid(profile.uid);
            void recordUserLastLogin(
              profile.uid,
              profile.organizationId,
              profile.defaultBranchId
            );
          }
          return;
        }

        // No user profile yet -> check pending invitation by verified email
        setUserProfile(null);
        try {
          const emailLower = (firebaseUser.email || '').toLowerCase();
          if (emailLower) {
            const invSnap = await getDocs(
              query(
                collection(db, 'invitations'),
                where('email', '==', emailLower),
                where('status', '==', 'pending')
              )
            );
            if (!invSnap.empty) {
              setPendingInvitation(invSnap.docs[0].data() as Invitation);
              setNeedsOrgSetup(false);
              setLoadingProfile(false);
              return;
            }
          }

          if (emailLower === BOOTSTRAP_EMAIL) {
            setNeedsOrgSetup(true);
          } else {
            setNeedsOrgSetup(false);
          }
        } catch {
          if ((firebaseUser.email || '').toLowerCase() === BOOTSTRAP_EMAIL) {
            setNeedsOrgSetup(true);
          }
        } finally {
          setLoadingProfile(false);
        }
      },
      (error) => {
        setLoadingProfile(false);
        handleFirestoreError(error, OperationType.GET, path);
      }
    );

    return () => unsub();
  }, [authReady, firebaseUser, loginLoggedUid]);

  // Listen to Organization, Role, Branches, Settings once userProfile is active
  useEffect(() => {
    if (!userProfile || userProfile.accountStatus !== 'active') {
      setUserRole(null);
      setOrganization(null);
      setSystemSettings(null);
      setBranches([]);
      return;
    }

    const orgId = userProfile.organizationId;

    const unsubOrg = onSnapshot(
      doc(db, 'organizations', orgId),
      (snap) => {
        setOrganization(snap.exists() ? (snap.data() as Organization) : null);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `organizations/${orgId}`)
    );

    const unsubRole = onSnapshot(
      doc(db, 'roles', userProfile.roleId),
      (snap) => {
        setUserRole(snap.exists() ? (snap.data() as Role) : null);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `roles/${userProfile.roleId}`)
    );

    const unsubBranches = onSnapshot(
      query(collection(db, 'branches'), where('organizationId', '==', orgId)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Branch);
        list.sort((a, b) => a.branchCode.localeCompare(b.branchCode));
        setBranches(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'branches')
    );

    const unsubSettings = onSnapshot(
      query(collection(db, 'systemSettings'), where('organizationId', '==', orgId)),
      (snap) => {
        if (!snap.empty) {
          setSystemSettings(snap.docs[0].data() as SystemSettings);
        } else {
          setSystemSettings(null);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'systemSettings')
    );

    return () => {
      unsubOrg();
      unsubRole();
      unsubBranches();
      unsubSettings();
    };
  }, [userProfile]);

  const isSuperAdmin = useMemo(
    () => Boolean(userRole?.scope === 'organization' && userRole?.isActive),
    [userRole]
  );

  const authorizedBranches = useMemo(() => {
    if (!userProfile || userProfile.accountStatus !== 'active') return [];
    if (isSuperAdmin) return branches;
    return branches.filter((b) => userProfile.branchIds.includes(b.branchId));
  }, [branches, isSuperAdmin, userProfile]);

  // Keep activeBranchId valid and synchronized
  useEffect(() => {
    if (!userProfile || authorizedBranches.length === 0) return;
    const isCurrentAllowed = authorizedBranches.some(
      (b) => b.branchId === activeBranchId
    );
    if (!isCurrentAllowed) {
      const def =
        authorizedBranches.find((b) => b.branchId === userProfile.defaultBranchId) ||
        authorizedBranches[0];
      if (def) {
        setActiveBranchState(def.branchId);
      }
    }
  }, [activeBranchId, authorizedBranches, userProfile]);

  const setActiveBranchId = useCallback(
    async (branchId: string) => {
      if (!userProfile || !checkBranchAccess(userProfile, userRole, branchId)) {
        throw new Error('Unauthorized branch selection.');
      }
      // Fresh backend token verification check on active branch switch
      await apiRequest('/api/auth/verify', { method: 'POST' }).catch(() => {});
      setActiveBranchState(branchId);
    },
    [userProfile, userRole]
  );

  const activeBranch = useMemo(
    () => authorizedBranches.find((b) => b.branchId === activeBranchId) || null,
    [authorizedBranches, activeBranchId]
  );

  const effectivePermissions = useMemo(
    () => resolveEffectivePermissions(userProfile, userRole),
    [userProfile, userRole]
  );

  const hasPermission = useCallback(
    (perm: string) => hasUserPermission(userProfile, userRole, perm),
    [userProfile, userRole]
  );

  const canAccessBranch = useCallback(
    (branchId: string) => checkBranchAccess(userProfile, userRole, branchId),
    [userProfile, userRole]
  );

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleProvider);
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  }, []);

  const acceptPendingInvitation = useCallback(async () => {
    if (!pendingInvitation) return;
    await claimInvitationForCurrentUser(pendingInvitation);
  }, [pendingInvitation]);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const isBootstrapEmail = useMemo(
    () => (firebaseUser?.email || '').toLowerCase() === BOOTSTRAP_EMAIL,
    [firebaseUser]
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        authReady,
        loadingProfile,
        userProfile,
        userRole,
        organization,
        systemSettings,
        branches,
        authorizedBranches,
        activeBranchId,
        activeBranch,
        setActiveBranchId,
        pendingInvitation,
        needsOrgSetup,
        isBootstrapEmail,
        isSuperAdmin,
        effectivePermissions,
        hasPermission,
        canAccessBranch,
        signInWithGoogle,
        signInWithEmail,
        requestPasswordReset,
        acceptPendingInvitation,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
