import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { isFirebaseConfigComplete } from './firebaseConfig.js';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Firebase is optional: without complete VITE_FIREBASE_* env values,
// getAuth() throws auth/invalid-api-key at import time, which would crash
// the whole app (blank page) even for users who never touch Firebase
// sign-in. initializeApp()/getAuth() run ONLY when all six required fields
// are present and non-empty; otherwise export a null auth so the app
// renders and guest collaboration keeps working.
export const isFirebaseConfigured = isFirebaseConfigComplete(firebaseConfig);

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;

if (!isFirebaseConfigured) {
  console.warn(
    '[firebase] Firebase client configuration is incomplete or missing — ' +
      'Firebase authentication is disabled. Guest collaboration remains available.',
  );
}