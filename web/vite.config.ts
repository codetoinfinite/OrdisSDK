import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The registry API (`pnpm dev` in the repo root). Vite proxies these prefixes to it in development.
const api = "http://127.0.0.1:3003";
const proxied = ["/api", "/mcp", "/swagger", "/demo"];

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: Object.fromEntries(
      proxied.map((prefix) => [prefix, { target: api, changeOrigin: true }]),
    ),
  },
  preview: { host: "127.0.0.1" },
});
