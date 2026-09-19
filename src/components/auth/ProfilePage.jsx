import React from 'react';

/**
 * ProfilePage — account screen for the signed-in user.
 *
 * Shows Name and Email for the current session user plus sign-out.
 * (Username editing is intentionally out of scope for the auth
 * foundation and is not offered here.)
 *
 * Props: {
 *   user: { displayName, email } | null,
 *   onLogout(),
 *   onBack(),
 *   onLogin(),
 *   onSignup(),
 * }
 */
export default function ProfilePage({ user, onLogout, onBack, onLogin, onSignup }) {

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
                    {user.displayName || user.name || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-[#57534E]">Email</dt>
                  <dd className="mt-1 truncate text-base text-[#111111]">{user.email || '—'}</dd>
                </div>
              </dl>
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
                  {user.displayName || user.name || user.email}
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
