import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "fs";
import type { UserConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "./package.json"), "utf-8"));
const version = pkg.version ?? "0.0.0";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 5173,
    hmr: {
      overlay: false,
    },
    proxy: {
      // In dev, proxy /api to Firebase Functions emulator or deployed function.
      // Set VITE_API_TARGET in frontend/.env to point at your emulator:
      //   VITE_API_TARGET=http://127.0.0.1:5001/YOUR_PROJECT_ID/us-central1
      "/api": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:5001/YOUR_PROJECT_ID/us-central1",
        changeOrigin: true,
        rewrite: (path: string) => {
          // Map /api/xxx paths to Cloud Function names.
          // Add entries here when you add new functions.
          if (path.startsWith("/api/items")) return path.replace("/api/items", "/itemsApi");
          if (path === "/api/support") return "/submitSupportTicket";
          if (path.startsWith("/api/admin-stats")) return path.replace("/api/admin-stats", "/getAdminStats");
          if (path === "/api/createCheckoutSession") return "/createCheckoutSession";
          if (path === "/api/createPortalSession") return "/createPortalSession";
          if (path === "/api/stripeWebhook") return "/stripeWebhook";
          if (path === "/api/changeSubscription") return "/changeSubscription";
          if (path === "/api/cancelSubscription") return "/cancelSubscription";
          if (path === "/api/reactivateSubscription") return "/reactivateSubscription";
          if (path === "/api/syncSubscription") return "/syncSubscription";
          if (path === "/api/triggerBackup") return "/triggerBackup";
          if (path.startsWith("/api/getInvoices")) return path.replace("/api/getInvoices", "/getInvoices");
          if (path === "/api/report-error") return "/reportFrontendError";
          return path;
        },
      },
    },
  },
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  } satisfies UserConfig["test"],
}));
