import React, { useState } from 'react';
import { signupRequest } from '../../lib/auth';
import GoogleButton from './GoogleButton';

/**
 * SignupPage — name, email, password only (no username field; usernames
 * are created later on the Profile page), plus "Continue with Google".
 * Same beige/white/black system as Dashboard/LandingPage.
 *
 * Props: { onSuccess(session), onSwitchToLogin(), onBack() }
 * where session is { token, user }.
 */
export default function SignupPage({ onSuccess, onSwitchToLogin, onBack }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!name.trim() || !email.trim() || !password) {
      setError('Name, email, and password are all required.');
      return;
    }
    setBusy(true);
    try {
      const session = await signupRequest({ name: name.trim(), email: email.trim(), password });
      onSuccess?.(session);
    } catch (err) {
      setError(err?.message || 'Could not create account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-1 flex-col bg-[#F5F1E8] text-[#57534E]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10 sm:px-6">
        <button
          type="button"
          onClick={onBack}
          className="self-start rounded-lg px-2 py-1 text-sm font-medium text-[#57534E] transition-colors hover:text-[#111111] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
        >
          ← Back to Dashboard
        </button>
        <section
          aria-labelledby="signup-title"
          className="mt-4 rounded-2xl border border-[#E7DFCC] bg-white p-6 sm:p-8"
        >
          <h1 id="signup-title" className="text-2xl font-bold tracking-tight text-[#111111]">
            Create your account
          </h1>
          <p className="mt-1.5 text-sm text-[#57534E]">
            Join SyncSpace to collaborate with your name on every edit.
          </p>
          <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
            <div>
              <label htmlFor="signup-name" className="text-sm font-medium text-[#57534E]">
                Name
              </label>
              <input
                id="signup-name"
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#E7DFCC] bg-white px-3.5 py-2.5 text-sm text-[#111111] placeholder:text-[#57534E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
              />
            </div>
            <div>
              <label htmlFor="signup-email" className="text-sm font-medium text-[#57534E]">
                Email
              </label>
              <input
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#E7DFCC] bg-white px-3.5 py-2.5 text-sm text-[#111111] placeholder:text-[#57534E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
              />
            </div>
            <div>
              <label htmlFor="signup-password" className="text-sm font-medium text-[#57534E]">
                Password
              </label>
              <input
                id="signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#E7DFCC] bg-white px-3.5 py-2.5 text-sm text-[#111111] placeholder:text-[#57534E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-rose-700">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="mt-1 flex w-full items-center justify-center rounded-lg bg-[#111111] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2A2A2A] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
            >
              {busy ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          <div className="my-5 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-[#E7DFCC]" />
            <span className="text-xs font-medium text-[#57534E]">or</span>
            <span className="h-px flex-1 bg-[#E7DFCC]" />
          </div>
          <GoogleButton onSuccess={onSuccess} disabled={busy} />
          <p className="mt-6 text-center text-sm text-[#57534E]">
            Already have an account?{' '}
            <button
              type="button"
              onClick={onSwitchToLogin}
              className="font-semibold text-[#111111] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
            >
              Log in
            </button>
          </p>
        </section>
      </div>
    </div>
  );
}
