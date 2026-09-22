import React from 'react';

/**
 * GoogleButton — starts the OAuth 2.0 authorization-code flow by
 * navigating the browser to the backend (`GET /api/auth/google`),
 * which redirects to Google. No Google Identity Services script, no
 * credential callback, no client secret anywhere near the browser —
 * the confidential exchange happens server-side and the app session
 * returns through the existing Axlero `{ user, token }` path.
 *
 * Props: { disabled? }
 */
export default function GoogleButton({ disabled = false }) {
  const handleClick = () => {
    if (disabled) return;
    try {
      const base =
        (typeof import.meta !== 'undefined' &&
          import.meta.env &&
          import.meta.env.VITE_SYNCSPACE_SERVER_URL) ||
        'http://localhost:3000';
      const root = String(base).replace(/\/+$/, '');
      window.location.assign(`${root}/api/auth/google`);
    } catch {
      // navigation unavailable (non-browser) — stay put
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[#E7DFCC] bg-white px-5 py-3 text-sm font-semibold text-[#111111] transition-colors hover:bg-[#EDE6D6] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.5h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.1.1 3.5 2.7.2.1c2.2-2 3.8-5 3.8-8.9z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.2 0-5.9-2.1-6.8-5l-.1.1-3.6 2.8v.1C3.5 21.4 7.5 24 12 24z"
          />
          <path
            fill="#FBBC05"
            d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-.1-.1-3.6-2.8-.1.1C.5 8.7 0 10.3 0 12s.5 3.3 1.4 4.7l3.8-2.3z"
          />
          <path
            fill="#EA4335"
            d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.5 0 3.5 2.6 1.4 6.8l3.8 2.9c.9-2.9 3.6-5 6.8-5z"
          />
        </svg>
        Continue with Google
      </button>
    </div>
  );
}
