import React, { useEffect, useRef, useState } from 'react';
import { googleRequest, renderGoogleButton } from '../../lib/auth';

/**
 * GoogleButton — "Continue with Google" via Google Identity Services.
 * No npm dependency: the GIS script is loaded on demand and renders the
 * official button. When no client ID is configured the button area shows
 * an honest note instead of a broken control.
 */
export default function GoogleButton({ onSuccess, disabled }) {
  const buttonRef = useRef(null);
  const [googleError, setGoogleError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const callbackRef = useRef(onSuccess);
  callbackRef.current = onSuccess;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    let cancelled = false;
    setGoogleError('');
    renderGoogleButton(buttonRef.current, async (credential) => {
      if (cancelled || disabledRef.current) return;
      try {
        const session = await googleRequest(credential);
        callbackRef.current?.(session);
      } catch (err) {
        if (!cancelled) setGoogleError(err?.message || 'Google sign-in failed');
      }
    }).catch((err) => {
      if (!cancelled) {
        // Missing client ID or blocked script — show a note, not a button.
        if (/not configured/i.test(err?.message || '')) setUnavailable(true);
        else setGoogleError(err?.message || 'Google sign-in failed');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (unavailable) {
    return (
      <p className="text-center text-xs text-[#57534E]">
        Google sign-in is not configured for this server.
      </p>
    );
  }

  return (
    <div>
      <div ref={buttonRef} className="flex justify-center" />
      {googleError && (
        <p role="alert" className="mt-2 text-center text-sm text-rose-700">
          {googleError}
        </p>
      )}
    </div>
  );
}
