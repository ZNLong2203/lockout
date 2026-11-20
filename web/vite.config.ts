import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API (lockout serve) listens on 127.0.0.1:8000; proxy /api so the app needs no CORS setup.
// `vite build --mode pages` builds the hosted demo for GitHub Pages, served under /lockout/.
export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? "/lockout/" : "/",
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
}));
