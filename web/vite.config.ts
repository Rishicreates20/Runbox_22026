import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_API_URL points the app at a real judge/auth server. Without it the
// app runs in demo mode with an in-browser judge simulator.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 700 },
});
