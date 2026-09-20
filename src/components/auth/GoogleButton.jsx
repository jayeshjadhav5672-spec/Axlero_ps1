import React, { useEffect, useRef, useState } from 'react';

/**
 * GoogleButton — real Google Identity Services sign-in button.
 *
 * Loads the GIS script once (module-level promise — never duplicated),
 * initializes with VITE_GOOGLE_CLIENT_ID, and renders Google's own
 * button into a container div. The Google credential flows out through
 * `onCredential(credential)`; LoginPage/SignupPage exchange it at
 * POST /api/auth/google. Failures (missing client ID, script load
 * failure) render an honest inline notice — a Google login is never
 * faked. No client secret exists or is referenced anywhere here.
 *
 * Props: { onCredential(credential), onError(message)?, disabled? }
 */

let gisScriptPromise = null;

function getClientId() {
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
  if (typeof window === 'undefined') return Promise.reject(new Error('Google sign-in needs a browser.'));
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
        reject(new Error('Could not load Google sign-in. Check your connection and try again.'));
      };
      document.head.appendChild(script);
    });
  }
  return gisScriptPromise;
}

export default function GoogleButton({ onCredential, onError, disabled = false }) {
  const containerRef = useRef(null);
  const [notice, setNotice] = useState('');
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    const clientId = getClientId();
    if (!clientId) {
      setNotice('Google sign-in isn\u2019t configured yet — coming soon.');
      return undefined;
    }
    loadGisScript()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        if (!window.google?.accounts?.id) throw new Error('Could not load Google sign-in.');
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response?.credential) callbackRef.current?.(response.credential);
            else errorRef.current?.('Google did not return a credential. Please try again.');
          },
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err?.message || 'Google sign-in is unavailable right now.';
        setNotice(message);
        errorRef.current?.(message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      {/* GIS renders its own control and exposes no disabled API, so the
          disabled state is enforced around it: `inert` removes the embedded
          iframe from tab order and hit-testing while a submission is in
          flight, preventing duplicate auth attempts. Visual dimming matches
          the surrounding form buttons. */}
      <div
        ref={containerRef}
        aria-label="Continue with Google"
        aria-disabled={disabled ? true : undefined}
        inert={disabled ? true : undefined}
        className={disabled ? 'pointer-events-none opacity-60' : undefined}
      />
      {notice && (
        <p role="status" className="mt-2 text-center text-xs text-[#57534E]">
          {notice}
        </p>
      )}
    </div>
  );
}
