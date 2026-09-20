/**
 * auth.js — frontend auth client (no React).
 *
 * Thin fetch wrapper over the backend auth API (POST /api/auth/signup,
 * POST /api/auth/login, GET /api/auth/me) plus localStorage session
 * handling ({ token, user }). Server URL resolution mirrors
 * src/lib/socket.js so both point at the same host. No Google OAuth —
 * the Google button stays an honest "not connected" notice.
 */

const API_BASE =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_SYNCSPACE_SERVER_URL) ||
  'http://localhost:3000';

const SESSION_KEY = 'syncspace:auth';

export function getApiBase() {
  try {
    return String(API_BASE).replace(/\/+$/, '');
  } catch {
    return 'http://localhost:3000';
  }
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
    throw new Error('Could not reach the server. Is the backend running?');
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
  return request('/api/auth/signup', {
    method: 'POST',
    body: { email, password, displayName: name },
  });
}

export function loginRequest({ email, password }) {
  return request('/api/auth/login', { method: 'POST', body: { email, password } });
}

/**
 * Google Sign-In: exchange a GIS credential for the standard Axlero
 * session ({ user, token }). Never sends anything but the credential;
 * never stores the Google token (only the Axlero session is stored).
 */
export function googleLoginRequest(credential) {
  if (typeof credential !== 'string' || !credential) {
    return Promise.reject(new Error('Google credential is required.'));
  }
  return request('/api/auth/google', { method: 'POST', body: { credential } });
}

export function meRequest(token) {
  return request('/api/auth/me', { token });
}

/** Stored session { token, user } or null. Never holds passwords. */
export function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token || !parsed.user) return null;
    return { token: parsed.token, user: parsed.user };
  } catch {
    return null;
  }
}

export function setStoredSession(session) {
  try {
    if (!session?.token || !session?.user) return;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: session.token, user: session.user }));
  } catch {
    // storage unavailable — session simply won't persist
  }
}

export function clearStoredSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
