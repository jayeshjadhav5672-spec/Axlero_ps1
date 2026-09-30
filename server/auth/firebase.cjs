/**
 * firebase.cjs — Firebase Admin SDK initialization and ID token verification.
 *
 * Initializes Firebase Admin exactly once using environment configuration.
 * Provides verifyFirebaseIdToken() to verify Firebase ID tokens and return
 * verified identity fields (uid, email, displayName).
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

let app = null;

function initializeFirebaseAdmin() {
  if (app) return app;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.'
    );
  }

  app = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
    projectId,
  });

  return app;
}

/**
 * Verify a Firebase ID token.
 * Returns verified identity: { uid, email, displayName }.
 * Throws a generic error on any verification failure.
 */
async function verifyFirebaseIdToken(idToken) {
  if (typeof idToken !== 'string' || !idToken.trim()) {
    throw new Error('Invalid Firebase ID token.');
  }

  try {
    initializeFirebaseAdmin();
    const decodedToken = await getAuth().verifyIdToken(idToken.trim());
    return {
      uid: decodedToken.uid,
      email: decodedToken.email ?? null,
      displayName: decodedToken.name ?? decodedToken.displayName ?? null,
    };
  } catch {
    throw new Error('Invalid Firebase ID token.');
  }
}

module.exports = { verifyFirebaseIdToken };