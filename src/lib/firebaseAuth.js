import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from './firebase.js';
import { requireFirebaseAuth } from './firebaseConfig.js';

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

function requireAuth() {
  return requireFirebaseAuth(auth, isFirebaseConfigured);
}

export async function signInWithGoogle() {
  const result = await signInWithPopup(requireAuth(), provider);
  const idToken = await result.user.getIdToken();
  return {
    idToken,
    uid: result.user.uid,
    email: result.user.email,
    displayName: result.user.displayName,
  };
}

export async function signUpWithEmail(email, password) {
  const result = await createUserWithEmailAndPassword(requireAuth(), email, password);
  const idToken = await result.user.getIdToken();
  return {
    idToken,
    uid: result.user.uid,
    email: result.user.email,
    displayName: result.user.displayName,
  };
}

export async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(requireAuth(), email, password);
  const idToken = await result.user.getIdToken();
  return {
    idToken,
    uid: result.user.uid,
    email: result.user.email,
    displayName: result.user.displayName,
  };
}

export async function signOutFirebase() {
  await signOut(requireAuth());
}

export function onAuthStateChanged(callback) {
  return requireAuth().onAuthStateChanged(callback);
}
