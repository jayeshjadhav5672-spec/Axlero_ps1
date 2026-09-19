/**
 * auth.js — frontend auth client (no React).
 *
 * Thin fetch wrapper over the backend auth endpoints
 * (server/auth.cjs, mounted at /api/auth). Server URL resolution mirrors
 * src/lib/socket.js so both point at the same host.
 */

const API_BASE =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_SYNCSPACE_SERVER_URL) ||
  'http://localhost:3000';

export function getApiBase() {
  return String(API_BASE).replace(/\/+$/, '');
}

async function request(path, { method = 'GET', body, token } = {}) {
  let response;
  try {
    response = await fetch(`${getApiBase()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('Could not reach the server. Start it with `npm run dev:server`.');
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error((data && data.error) || `Request failed (${response.status})`);
  }
  return data;
}

export function signupRequest({ name, email, password }) {
  return request('/api/auth/signup', { method: 'POST', body: { name, email, password } });
}

export function loginRequest({ email, password }) {
  return request('/api/auth/login', { method: 'POST', body: { email, password } });
}

export function googleRequest(idToken) {
  return request('/api/auth/google', { method: 'POST', body: { idToken } });
}

export function updateUsernameRequest(username, token) {
  return request('/api/auth/username', { method: 'PATCH', body: { username }, token });
}

/* ------------------------------------------------------------------ */
/* Google Identity Services (button only — no npm dependency)          */
/* ------------------------------------------------------------------ */

let gisScriptPromise = null;

export function getGoogleClientId() {
  try {
    return (
      (typeof import.meta !== 'undefined' &&
        import.meta.env &&
        import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
      ''
    );
  } catch {
    return '';
  }
}

function loadGisScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google sign-in needs a browser'));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gisScriptPromise) {
    gisScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisScriptPromise = null;
        reject(new Error('Could not load Google sign-in'));
      };
      document.head.appendChild(script);
    });
  }
  return gisScriptPromise;
}

/**
 * Render the Google "Continue with Google" button into `element`.
 * Resolves with the ID token via onCredential. Rejects when no client
 * ID is configured or the script fails to load.
 */
export async function renderGoogleButton(element, onCredential) {
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error('Google sign-in is not configured');
  await loadGisScript();
  if (!window.google?.accounts?.id) throw new Error('Could not load Google sign-in');
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => {
      if (response?.credential) onCredential(response.credential);
    },
  });
  window.google.accounts.id.renderButton(element, {
    theme: 'outline',
    size: 'large',
    width: 320,
  });
}
