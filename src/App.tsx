import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import WebhookLogs from "./pages/WebhookLogs";
import { EscalationHub } from "./pages/EscalationHub";
import { MobileEscalationHub } from "./pages/mobile/MobileEscalationHub";
import { AuthGuard } from "./components/AuthGuard";
import { useIsMobile } from "./hooks/use-mobile";

const queryClient = new QueryClient();

const RouterContent = () => {
  const isMobile = useIsMobile();

  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route 
        path="/" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="my-tickets" />
            ) : (
              <EscalationHub filter="my-tickets" />
            )}
          </AuthGuard>
        } 
      />
      <Route 
        path="/unassigned" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="unassigned" />
            ) : (
              <EscalationHub filter="unassigned" />
            )}
          </AuthGuard>
        } 
      />
      <Route 
        path="/sla-risk" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="sla-risk" />
            ) : (
              <EscalationHub filter="sla-risk" />
            )}
          </AuthGuard>
        } 
      />
      <Route 
        path="/all-open" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="all-open" />
            ) : (
              <EscalationHub filter="all-open" />
            )}
          </AuthGuard>
        } 
      />
      <Route 
        path="/completed" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="completed" />
            ) : (
              <EscalationHub filter="completed" />
            )}
          </AuthGuard>
        } 
      />
      <Route 
        path="/high-priority" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="high-priority" />
            ) : (
              <EscalationHub filter="high-priority" />
            )}
          </AuthGuard>
        } 
      />
      <Route 
        path="/vip-customers" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="vip-customers" />
            ) : (
              <EscalationHub filter="vip-customers" />
            )}
          </AuthGuard>
        } 
      />
      <Route 
        path="/settings" 
        element={
          <AuthGuard>
            <Settings />
          </AuthGuard>
        } 
      />
      <Route 
        path="/webhooks" 
        element={
          <AuthGuard>
            <WebhookLogs />
          </AuthGuard>
        } 
      />
      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <RouterContent />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
