import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "fs";
import type { UserConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "./package.json"), "utf-8"));
const version = pkg.version ?? "0.0.0";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv reads .env, .env.local, .env.[mode] etc. and makes them available
  // in the config file itself (process.env only has shell-level vars here).
  const env = loadEnv(mode, process.cwd(), "");

  const apiTarget =
    env.VITE_API_TARGET ||
    process.env.VITE_API_TARGET ||
    "http://127.0.0.1:5001/fieldstack-testing/us-central1";

  if (!env.VITE_API_TARGET && !process.env.VITE_API_TARGET) {
    console.warn(
      `[vite.config] VITE_API_TARGET is not set in frontend/.env — ` +
      `falling back to ${apiTarget}. Set VITE_API_TARGET to silence this warning.`
    );
  }

  return {
  server: {
    host: "::",
    port: 5173,
    hmr: {
      overlay: false,
    },
    proxy: {
      // In dev, proxy /api/* to Firebase Functions emulator or deployed functions.
      // Set VITE_API_TARGET in frontend/.env:
      //   VITE_API_TARGET=http://127.0.0.1:5001/YOUR_PROJECT_ID/us-central1
      "/api": {
        target: apiTarget,
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
          // ── FieldStack domain routes ──────────────────────────────────────
          if (path.startsWith("/api/my-tasks")) return path.replace("/api/my-tasks", "/myTasksApi");
          if (path.startsWith("/api/projects")) return path.replace("/api/projects", "/projectsApi");
          if (path.startsWith("/api/orders")) return path.replace("/api/orders", "/ordersApi");
          if (path.startsWith("/api/alerts/send-to-member")) return path.replace("/api/alerts/send-to-member", "/alertsSendToMemberApi");
          if (path.startsWith("/api/alerts")) return path.replace("/api/alerts", "/alertsSendApi");
          if (path.startsWith("/api/briefing")) return path.replace("/api/briefing", "/briefingApi");
          if (path.startsWith("/api/chat")) return path.replace("/api/chat", "/chatApi");
          if (path.startsWith("/api/feed")) return path.replace("/api/feed", "/feedApi");
          if (path.startsWith("/api/gmail/callback")) return path.replace("/api/gmail/callback", "/gmailCallbackApi");
          if (path.startsWith("/api/gmail/scan")) return path.replace("/api/gmail/scan", "/gmailScanApi");
          if (path.startsWith("/api/gmail")) return path.replace("/api/gmail", "/gmailApi");
          if (path.startsWith("/api/team")) return path.replace("/api/team", "/teamApi");
          if (path.startsWith("/api/settings/lead-times")) return path.replace("/api/settings/lead-times", "/leadTimesApi");
          if (path.startsWith("/api/schedules/upload")) return path.replace("/api/schedules/upload", "/schedulesUploadApi");
          if (path.startsWith("/api/schedules")) return path.replace("/api/schedules", "/schedulesUploadApi");
          if (path.startsWith("/api/sms-briefing")) return path.replace("/api/sms-briefing", "/smsBriefingApi");
          if (path.startsWith("/api/procore/auth-url")) return path.replace("/api/procore/auth-url", "/procoreAuthUrlApi");
          if (path.startsWith("/api/procore/callback")) return path.replace("/api/procore/callback", "/procoreCallbackApi");
          if (path.startsWith("/api/procore/sync")) return path.replace("/api/procore/sync", "/procoreSyncApi");
          if (path.startsWith("/api/procore")) return path.replace("/api/procore", "/procoreAuthUrlApi");
          if (path.startsWith("/api/steps")) return path.replace("/api/steps", "/stepsApi");
          if (path.startsWith("/api/magic-link")) return path.replace("/api/magic-link", "/magicLinkApi");
          if (path.startsWith("/api/escalation")) return path.replace("/api/escalation", "/escalationApi");
          if (path.startsWith("/api/gc-draft")) return path.replace("/api/gc-draft", "/gcDraftApi");
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
  };
});
