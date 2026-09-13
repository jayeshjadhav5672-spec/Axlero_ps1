import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  // A globally exported NODE_ENV=production makes the dev server pre-bundle
  // React's production build, whose jsx-dev-runtime has `jsxDEV = undefined`.
  // The dev transform still calls it, so the app throws "_jsxDEV is not a
  // function" and renders a blank page. `vite dev` is always development.
  if (command === 'serve') process.env.NODE_ENV = 'development';

  return {
    plugins: [react()],
  };
});

