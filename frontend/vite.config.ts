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
      // In dev, proxy /api/search → Firebase Functions emulator or deployed function
      "/api": {
        target: process.env.VITE_API_TARGET || "https://us-central1-search-edc58.cloudfunctions.net",
        changeOrigin: true,
        rewrite: (path: string) => {
          // /api/search → /dataforseoBusinessSearch
          if (path === "/api/search") return "/dataforseoBusinessSearch";
          // /api/businesses → /getBusinessesByCids
          if (path === "/api/businesses") return "/getBusinessesByCids";
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
