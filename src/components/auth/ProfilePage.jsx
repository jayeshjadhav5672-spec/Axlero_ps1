import React, { useState } from 'react';
import { updateUsernameRequest } from '../../lib/auth';

/**
 * ProfilePage — the authenticated user's account screen.
 *
 * - "Profile information" card: Name, Username, Email for the current user.
 * - Usernames are created HERE (never at signup) via the username form.
 * - "Account" user section below it: account id, role, and sign-out —
 *   kept visually subordinate to the profile information, in the same
 *   beige/white/black system as Dashboard/LandingPage.
 *
 * Props: { user, token, onUsernameSaved(user), onLogout(), onBack() }
 */
export default function ProfilePage({ user, token, onUsernameSaved, onLogout, onBack }) {
  const [username, setUsername] = useState(user?.username || '');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleUsernameSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!username.trim()) {
      setError('Enter a username to save.');
      return;
    }
    setBusy(true);
    try {
      const data = await updateUsernameRequest(username.trim(), token);
      onUsernameSaved?.(data.user);
      setNotice(data.user?.username ? `Username set to “${data.user.username}”.` : 'Username saved.');
    } catch (err) {
      setError(err?.message || 'Could not save username.');
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
          aria-labelledby="profile-title"
          className="mt-4 rounded-2xl border border-[#E7DFCC] bg-white p-6 sm:p-8"
        >
          <h1 id="profile-title" className="text-2xl font-bold tracking-tight text-[#111111]">
            Profile information
          </h1>
          <p className="mt-1.5 text-sm text-[#57534E]">
            This is how you appear to collaborators in every room.
          </p>
          <dl className="mt-6 flex flex-col gap-4">
            <div>
              <dt className="text-sm font-medium text-[#57534E]">Name</dt>
              <dd className="mt-1 truncate text-base font-semibold text-[#111111]">
                {user?.name || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[#57534E]">Username</dt>
              <dd className="mt-1 truncate font-mono text-base text-[#111111]">
                {user?.username || 'Not set yet'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[#57534E]">Email</dt>
              <dd className="mt-1 truncate text-base text-[#111111]">{user?.email || '—'}</dd>
            </div>
          </dl>

          <form onSubmit={handleUsernameSubmit} noValidate className="mt-6 flex flex-col gap-2.5 border-t border-[#E7DFCC] pt-6">
            <label htmlFor="profile-username" className="text-sm font-medium text-[#57534E]">
              {user?.username ? 'Change username' : 'Choose a username'}
            </label>
            <input
              id="profile-username"
              name="username"
              type="text"
              autoComplete="username"
              spellCheck={false}
              placeholder="e.g. ada-lovelace"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                if (error) setError('');
                if (notice) setNotice('');
              }}
              className="w-full rounded-lg border border-[#E7DFCC] bg-white px-3.5 py-2.5 font-mono text-sm text-[#111111] placeholder:font-sans placeholder:text-[#57534E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]"
            />
            {error && (
              <p role="alert" className="text-sm text-rose-700">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm text-emerald-700">
                {notice}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="mt-1 flex w-full items-center justify-center rounded-lg bg-[#111111] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2A2A2A] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
            >
              {busy ? 'Saving…' : 'Save username'}
            </button>
          </form>
        </section>

        <section
          aria-labelledby="profile-account-title"
          className="mt-4 rounded-2xl border border-[#E7DFCC] bg-white p-6 sm:p-8"
        >
          <h2 id="profile-account-title" className="text-base font-semibold text-[#111111]">
            Account
          </h2>
          <dl className="mt-3 flex flex-col gap-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#57534E]">User ID</dt>
              <dd className="min-w-0 truncate font-mono text-xs text-[#111111]">{user?.id || '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#57534E]">Role</dt>
              <dd className="font-medium capitalize text-[#111111]">{user?.role || 'Member'}</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={onLogout}
            className="mt-5 flex w-full items-center justify-center rounded-lg border border-[#E7DFCC] bg-white px-5 py-2.5 text-sm font-semibold text-[#111111] transition-colors hover:bg-[#EDE6D6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
          >
            Sign out
          </button>
        </section>
      </div>
    </div>
  );
}
