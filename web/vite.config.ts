import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API (lockout serve) listens on 127.0.0.1:8000; proxy /api so the app needs no CORS setup.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
