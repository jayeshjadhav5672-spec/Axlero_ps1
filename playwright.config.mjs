import { defineConfig } from '@playwright/test';

/**
 * Local two-client browser harness (Guest flows only — no Firebase).
 * Serves the built frontend and the realtime backend on loopback:
 * - backend: node server/index.cjs (PORT=3001, no MongoDB needed)
 * - frontend: vite preview of dist/ (:4173), talking to :3001
 *
 * Run via `npm run test:e2e` (scripts/run-e2e.mjs rebuilds dist/ against
 * the test backend first, so a stale bundle can never be tested silently).
 * Two-client tests use separate browser contexts (separate storage).
 */
const BACKEND_PORT = 3001;
const FRONTEND_PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `node server/index.cjs`,
      port: BACKEND_PORT,
      env: {
        ...process.env,
        PORT: String(BACKEND_PORT),
        VITE_SYNCSPACE_SERVER_URL: `http://localhost:${BACKEND_PORT}`,
      },
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: `npx vite preview --port ${FRONTEND_PORT} --strictPort`,
      port: FRONTEND_PORT,
      env: {
        ...process.env,
        VITE_SYNCSPACE_SERVER_URL: `http://localhost:${BACKEND_PORT}`,
      },
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
  projects: [{ name: 'chromium' }],
});
