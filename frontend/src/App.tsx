import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { useEffect } from "react";
import { toast } from "sonner";
import Login from "./pages/Login";
import { ProtectedAdminRoute } from "@/components/ProtectedAdminRoute";
import { DevRateLimitTester } from "@/components/DevRateLimitTester";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// One-time migration: clear saved leads/searches that use the old `biz-XXX`
// id format so they don't break with the new CID-based schema.
function useSavedLeadsMigration() {
  useEffect(() => {
    const MIGRATION_KEY = "cozyleads-migration-v1";
    if (localStorage.getItem(MIGRATION_KEY)) return;
    let cleared = false;
    try {
      const saved = JSON.parse(localStorage.getItem("cozyleads-saved") || "[]");
      if (Array.isArray(saved) && saved.some((l: any) => l?.business?.id?.startsWith?.("biz-"))) {
        localStorage.removeItem("cozyleads-saved");
        cleared = true;
      }
      const searches = JSON.parse(localStorage.getItem("cozyleads-searches") || "[]");
      if (Array.isArray(searches) && searches.some((s: any) => (s?.resultIds || []).some?.((id: string) => id?.startsWith?.("biz-")))) {
        localStorage.removeItem("cozyleads-searches");
        cleared = true;
      }
    } catch {
      // ignore
    }
    localStorage.setItem(MIGRATION_KEY, "1");
    if (cleared) {
      toast("Saved leads cleared", { description: "Updated to the new data format." });
    }
  }, []);
}
import { lazy, Suspense } from "react";
import Index from "./pages/Index.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import SearchHistory from "./pages/SearchHistory.tsx";
import Settings from "./pages/Settings.tsx";
import Billing from "./pages/Billing.tsx";
const SystemAdmin = lazy(() => import("./pages/SystemAdmin.tsx"));
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <AppLayout>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/search-history" element={<SearchHistory />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/admin" element={<ProtectedAdminRoute element={<Suspense fallback={null}><SystemAdmin /></Suspense>} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </AppLayout>
  );
}

const App = () => {
  useSavedLeadsMigration();
  return (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthGate />
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </AuthProvider>
  </QueryClientProvider>
  );
};

export default App;
