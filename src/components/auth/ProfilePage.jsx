import React, { useState } from 'react';

/**
 * ProfilePage — frontend-only profile screen.
 *
 * Shows Name, Username, and Email for the current in-memory session
 * user. The username is entered/edited HERE (never on Signup):
 * typing a valid username and saving hands it to `onUsernameSaved`
 * (in-memory React state in App — nothing is persisted and nothing is
 * sent to a backend; the auth teammate wires that up).
 *
 * Below the profile information sits the Account user section: who is
 * currently signed in on this device, plus sign-out. When there is no
 * session user, a prompt with Create account / Login entry points is
 * shown instead.
 *
 * Props: {
 *   user: { name, email, username } | null,
 *   onUsernameSaved(username),
 *   onLogout(),
 *   onBack(),
 *   onLogin(),
 *   onSignup(),
 * }
 */
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;

export default function ProfilePage({ user, onUsernameSaved, onLogout, onBack, onLogin, onSignup }) {
  const [username, setUsername] = useState(user?.username || '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleUsernameSubmit = (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const trimmed = username.trim();
    if (!trimmed) {
      setError('Enter a username to save.');
      return;
    }
    if (!USERNAME_PATTERN.test(trimmed)) {
      setError('Username must be 3–32 characters: letters, numbers, _ . -');
      return;
    }
    // Frontend-only: hand the valid username up; no network, no storage.
    onUsernameSaved?.(trimmed);
    setNotice(trimmed ? `Username set to “${trimmed}”.` : 'Username saved.');
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

        {!user ? (
          <section
            aria-labelledby="profile-empty-title"
            className="mt-4 rounded-2xl border border-[#E7DFCC] bg-white p-6 text-center sm:p-8"
          >
            <h1 id="profile-empty-title" className="text-2xl font-bold tracking-tight text-[#111111]">
              No profile yet
            </h1>
            <p className="mt-1.5 text-sm text-[#57534E]">
              Create an account or log in to see your profile here.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={onSignup}
                className="flex w-full items-center justify-center rounded-lg bg-[#111111] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={onLogin}
                className="flex w-full items-center justify-center rounded-lg border border-[#E7DFCC] bg-white px-5 py-2.5 text-sm font-semibold text-[#111111] transition-colors hover:bg-[#EDE6D6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
              >
                Login
              </button>
            </div>
          </section>
        ) : (
          <>
            <section
              aria-labelledby="profile-title"
              className="mt-4 rounded-2xl border border-[#E7DFCC] bg-white p-6 sm:p-8"
            >
              <h1 id="profile-title" className="text-2xl font-bold tracking-tight text-[#111111]">
                Profile
              </h1>
              <p className="mt-1.5 text-sm text-[#57534E]">
                This is how you appear to collaborators in every room.
              </p>
              <dl className="mt-6 flex flex-col gap-4">
                <div>
                  <dt className="text-sm font-medium text-[#57534E]">Name</dt>
                  <dd className="mt-1 truncate text-base font-semibold text-[#111111]">
                    {user.name || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-[#57534E]">Username</dt>
                  <dd className="mt-1 truncate font-mono text-base text-[#111111]">
                    {user.username || 'Not set yet'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-[#57534E]">Email</dt>
                  <dd className="mt-1 truncate text-base text-[#111111]">{user.email || '—'}</dd>
                </div>
              </dl>

              <form
                onSubmit={handleUsernameSubmit}
                noValidate
                className="mt-6 flex flex-col gap-2.5 border-t border-[#E7DFCC] pt-6"
              >
                <label htmlFor="profile-username" className="text-sm font-medium text-[#57534E]">
                  {user.username ? 'Change username' : 'Choose a username'}
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
                  aria-invalid={error ? true : undefined}
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
                  className="mt-1 flex w-full items-center justify-center rounded-lg bg-[#111111] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2A2A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
                >
                  Save username
                </button>
              </form>
            </section>

            <section
              aria-labelledby="profile-user-title"
              className="mt-4 rounded-2xl border border-[#E7DFCC] bg-white p-6 sm:p-8"
            >
              <h2 id="profile-user-title" className="text-base font-semibold text-[#111111]">
                User
              </h2>
              <p className="mt-1 text-sm text-[#57534E]">
                Signed in on this device as{' '}
                <span className="font-medium text-[#111111]">
                  {user.username || user.name || user.email}
                </span>
                . Signing out clears this device session only.
              </p>
              <button
                type="button"
                onClick={onLogout}
                className="mt-5 flex w-full items-center justify-center rounded-lg border border-[#E7DFCC] bg-white px-5 py-2.5 text-sm font-semibold text-[#111111] transition-colors hover:bg-[#EDE6D6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
              >
                Sign out
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
