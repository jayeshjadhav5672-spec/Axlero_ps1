/**
 * run-e2e.mjs — deterministic local end-to-end runner.
 *
 * The preview server serves whatever is in dist/, so running Playwright
 * against a stale bundle silently tests the wrong backend URL. This
 * orchestrator always rebuilds dist/ against the e2e backend URL first,
 * then runs Playwright (which starts the backend + preview servers).
 * Extra CLI args pass through to `playwright test`.
 *
 * Usage: npm run test:e2e [-- <playwright args>]
 */
import { spawnSync } from 'node:child_process';

const BACKEND_URL = process.env.VITE_SYNCSPACE_SERVER_URL || 'http://localhost:3001';

function run(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  return result.status ?? 1;
}

const build = run('npm', ['run', 'build'], { VITE_SYNCSPACE_SERVER_URL: BACKEND_URL });
if (build !== 0) {
  console.error(`run-e2e: production build failed (exit ${build}); refusing to test a stale bundle.`);
  process.exit(build);
}
const code = run('npx', ['playwright', 'test', ...process.argv.slice(2)], {});
process.exit(code);
