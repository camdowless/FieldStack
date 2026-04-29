import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET || "http://127.0.0.1:5001/fieldstack-testing/us-central1";

  return {
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      // Proxy /api/* → Firebase Functions emulator (dev) or deployed functions (prod).
      // Set VITE_API_TARGET in .env.local for the emulator base URL, e.g.:
      //   http://127.0.0.1:5001/your-project/us-central1
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path: string) => {
          // Paths where the function name differs from the URL segment
          if (path.startsWith("/api/admin-stats")) return "/getAdminStats";
          if (path.startsWith("/api/admin-reports")) return "/getAdminReports";
          if (path === "/api/update-report-status") return "/updateReportStatus";
          if (path === "/api/report") return "/submitReport";
          if (path.startsWith("/api/fieldstack/")) return path.replace("/api/fieldstack/", "/");
          // Default: strip /api/ prefix — function name matches the URL segment
          return path.replace(/^\/api\//, "/");
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
  };
});
