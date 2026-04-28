import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      // In dev, proxy /api → Firebase Functions emulator or deployed functions
      // Set VITE_API_TARGET to your deployed functions URL, e.g.:
      //   https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net
      "/api": {
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:5001",
        changeOrigin: true,
        rewrite: (path: string) => {
          if (path.startsWith("/api/admin-stats")) return path.replace("/api/admin-stats", "/getAdminStats");
          if (path.startsWith("/api/admin-reports")) return path.replace("/api/admin-reports", "/getAdminReports");
          if (path === "/api/update-report-status") return "/updateReportStatus";
          if (path === "/api/report") return "/submitReport";
          if (path === "/api/createCheckoutSession") return "/createCheckoutSession";
          if (path === "/api/createPortalSession") return "/createPortalSession";
          if (path === "/api/stripeWebhook") return "/stripeWebhook";
          return path;
        },
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
