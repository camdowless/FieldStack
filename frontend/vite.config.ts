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
      // In dev, proxy /api → Firebase Functions emulator or deployed function
      "/api": {
        target: process.env.VITE_API_TARGET || "https://us-central1-gimmeleads-10cdd.cloudfunctions.net",
        changeOrigin: true,
        rewrite: (path: string) => {
          // Order matters: more specific paths first
          if (path === "/api/search/cancel") return "/cancelSearchJob";
          if (path === "/api/search") return "/dataforseoBusinessSearch";
          if (path === "/api/businesses") return "/getBusinessesByCids";
          if (path === "/api/recalculate-business-rank") return "/recalculateBusinessRank";
          if (path.startsWith("/api/ghost-businesses")) return path.replace("/api/ghost-businesses", "/getGhostBusinesses");
          if (path.startsWith("/api/admin-stats")) return path.replace("/api/admin-stats", "/getAdminStats");
          if (path.startsWith("/api/admin-reports")) return path.replace("/api/admin-reports", "/getAdminReports");
          if (path === "/api/update-report-status") return "/updateReportStatus";
          if (path === "/api/audit-dead-sites") return "/auditDeadSites";
          if (path === "/api/reevaluate-business") return "/reevaluateBusiness";
          if (path.startsWith("/api/photos")) return path.replace("/api/photos", "/getBusinessPhotos");
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
