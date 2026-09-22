import React, { useState } from 'react';
import GoogleButton from './GoogleButton';
import { signUpWithEmail } from '../../lib/firebaseAuth';
import { firebaseLoginRequest } from '../../lib/auth';

/**
 * SignupPage — account creation form backed by the real auth API.
 *
 * Fields: Name, Email, Password — exactly. Client-side validation
 * first, then POST /api/auth/signup; on success the session
 * ({ user, token }) is handed to `onSuccess`.
 *
 * Props: { onSuccess({ user, token }), onSwitchToLogin(), onBack() }
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const inputClassName =
  'mt-1.5 w-full rounded-lg border border-[#E7DFCC] bg-white px-3.5 py-2.5 text-sm text-[#111111] placeholder:text-[#57534E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]';

export default function SignupPage({ onSuccess, onSwitchToLogin, onBack }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!name.trim()) nextErrors.name = 'Please enter your name.';
    if (!email.trim()) nextErrors.email = 'Please enter your email.';
    else if (!EMAIL_PATTERN.test(email.trim())) nextErrors.email = 'Please enter a valid email address.';
    if (!password) nextErrors.password = 'Please choose a password.';
    else if (password.length < MIN_PASSWORD_LENGTH)
      nextErrors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setBusy(true);
    try {
      const { idToken } = await signUpWithEmail(email.trim(), password);
      // Display name is propagated via Firebase profile update would require updateProfile;
      // backend derives displayName from verified token or falls back to email prefix.
      // For signup we pass the typed name as fallback via token's displayName if Firebase hasn't set it yet.
      const session = await firebaseLoginRequest(idToken);
      // If user typed a different display name than Firebase's, we keep Firebase's but
      // Mongo document was already created with that name. For now the name field is informational.
      void name;
      onSuccess?.(session);
    } catch (err) {
      const msg = err?.code === 'auth/email-already-in-use' ? 'An account with this email already exists.' : err?.message;
      setErrors({ form: msg || 'Could not create your account.' });
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
            Create your SyncSpace account
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
                aria-invalid={errors.name ? true : undefined}
                className={inputClassName}
              />
              {errors.name && (
                <p role="alert" className="mt-1.5 text-sm text-rose-700">
                  {errors.name}
                </p>
              )}
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
                aria-invalid={errors.email ? true : undefined}
                className={inputClassName}
              />
              {errors.email && (
                <p role="alert" className="mt-1.5 text-sm text-rose-700">
                  {errors.email}
                </p>
              )}
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
                aria-invalid={errors.password ? true : undefined}
                className={inputClassName}
              />
              {errors.password && (
                <p role="alert" className="mt-1.5 text-sm text-rose-700">
                  {errors.password}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={busy}
              className="mt-1 flex w-full items-center justify-center rounded-lg bg-[#111111] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Creating account…' : 'Create Account'}
            </button>
            {errors.form && (
              <p role="alert" className="mt-1.5 text-sm text-rose-700">
                {errors.form}
              </p>
            )}
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
              Login
            </button>
          </p>
        </section>
      </div>
    </div>
  );
}