import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  GoogleAuthProvider,
  sendEmailVerification,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const provisionerApp =
  getApps().find((a) => a.name === 'staff_provisioner') ||
  initializeApp(firebaseConfig, 'staff_provisioner');

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const provisionerAuth = getAuth(provisionerApp);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

function mapAuthProvisionError(error: unknown): Error {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';

  if (code === 'auth/operation-not-allowed') {
    return new Error(
      `Email/Password sign-in is not enabled yet in Firebase Console for project "${firebaseConfig.projectId}". Enable Authentication -> Sign-in method -> Email/Password first.`
    );
  }
  if (code === 'auth/email-already-in-use') {
    return new Error('An authentication account with this email already exists.');
  }
  if (code === 'auth/weak-password') {
    return new Error('Password is too weak. Use at least 8 characters with letters and numbers.');
  }
  if (code === 'auth/invalid-email') {
    return new Error('Enter a valid staff email address.');
  }
  return error instanceof Error ? error : new Error('Unable to create staff authentication account.');
}

export async function provisionStaffAuthUser(params: {
  email: string;
  password: string;
  displayName: string;
  onAuthCreated: (uid: string) => Promise<void>;
}): Promise<{ uid: string; verificationEmailSent: boolean }> {
  let createdUser: import('firebase/auth').User | null = null;
  let verificationEmailSent = false;

  try {
    const cred = await createUserWithEmailAndPassword(
      provisionerAuth,
      params.email.trim().toLowerCase(),
      params.password
    );
    createdUser = cred.user;

    if (params.displayName.trim()) {
      await updateProfile(cred.user, { displayName: params.displayName.trim() }).catch(() => {});
    }

    try {
      await params.onAuthCreated(cred.user.uid);
    } catch (profileError) {
      await deleteUser(cred.user).catch(() => {});
      throw profileError;
    }

    try {
      await sendEmailVerification(cred.user);
      verificationEmailSent = true;
    } catch {
      verificationEmailSent = false;
    }

    return { uid: cred.user.uid, verificationEmailSent };
  } catch (error) {
    if (createdUser) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    throw mapAuthProvisionError(error);
  } finally {
    await signOut(provisionerAuth).catch(() => {});
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration. Firestore client is offline.');
    }
  }
}
void testConnection();
