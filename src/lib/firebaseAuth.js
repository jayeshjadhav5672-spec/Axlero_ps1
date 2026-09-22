import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { auth } from './firebase.js';

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken();
  return {
    idToken,
    uid: result.user.uid,
    email: result.user.email,
    displayName: result.user.displayName,
  };
}

export async function signOutFirebase() {
  await signOut(auth);
}

export function onAuthStateChanged(callback) {
  return auth.onAuthStateChanged(callback);
}