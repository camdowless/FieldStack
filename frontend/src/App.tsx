import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { VerifyEmailScreen } from "@/components/VerifyEmailScreen";
import { ProfileSetupScreen } from "@/components/ProfileSetupScreen";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProtectedAdminRoute } from "@/components/ProtectedAdminRoute";
import { CompanySetupScreen } from "@/components/company/CompanySetupScreen";
import { lazy, Suspense } from "react";
import Login from "./pages/Login";
import AppHome from "./pages/AppHome";
import Settings from "./pages/Settings";
import Billing from "./pages/Billing";
import Help from "./pages/Help";
import AuthAction from "./pages/AuthAction";
import NotFound from "./pages/NotFound";
import Projects from "./pages/Projects";
const ProjectDetail = lazy(() => import("./pages/ProjectDetail"));

const SystemAdmin = lazy(() => import("./pages/SystemAdmin"));

const queryClient = new QueryClient();

function AuthGate() {
  const { user, loading, isNewUser, emailVerified, profile } = useAuth();

  const isEmailProvider = user?.providerData.some((p) => p.providerId === "password") ?? false;
  // const needsVerification = isEmailProvider && !emailVerified;
  const needsVerification = false; // disabled for local testing

  if (loading) {
    if (isNewUser) {
      return <ProfileSetupScreen />;
    }
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  if (needsVerification) {
    return <VerifyEmailScreen />;
  }

  // If the user has a profile but no company yet, show the company onboarding screen.
  if (profile && !profile.companyId) {
    return <CompanySetupScreen />;
  }

  return (
    <AppLayout>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Projects />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:projectId" element={<Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}><ProjectDetail /></Suspense>} />
          <Route path="/home" element={<AppHome />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/help" element={<Help />} />
          <Route path="/admin" element={<ProtectedAdminRoute element={<Suspense fallback={null}><SystemAdmin /></Suspense>} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </AppLayout>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/auth/action" element={<AuthAction />} />
              <Route path="*" element={<AuthGate />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
