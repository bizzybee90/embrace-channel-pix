import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import React from "react";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import WebhookLogs from "./pages/WebhookLogs";
import Privacy from "./pages/Privacy";
import Escalations from "./pages/Escalations";
import { EscalationHub } from "./pages/EscalationHub";
import { MobileEscalationHub } from "./pages/mobile/MobileEscalationHub";
import { AuthGuard } from "./components/AuthGuard";
import { useIsMobile } from "./hooks/use-mobile";
import { LiveActivityDashboard } from "./components/dashboard/LiveActivityDashboard";
import ChannelsDashboard from "./pages/ChannelsDashboard";
import ChannelConversations from "./pages/ChannelConversations";
import ChannelAnalytics from "./pages/ChannelAnalytics";

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
            <LiveActivityDashboard />
          </AuthGuard>
        } 
      />
      <Route 
        path="/my-tickets" 
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
        path="/sent" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="sent" />
            ) : (
              <EscalationHub filter="sent" />
            )}
          </AuthGuard>
        } 
      />
      <Route 
        path="/awaiting-reply" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="awaiting-reply" />
            ) : (
              <EscalationHub filter="awaiting-reply" />
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
        path="/escalations" 
        element={
          <AuthGuard>
            <Escalations />
          </AuthGuard>
        } 
      />
      <Route 
        path="/channels" 
        element={
          <AuthGuard>
            <ChannelsDashboard />
          </AuthGuard>
        } 
      />
      <Route 
        path="/channel/:channel" 
        element={
          <AuthGuard>
            <ChannelConversations />
          </AuthGuard>
        } 
      />
      <Route 
        path="/analytics" 
        element={
          <AuthGuard>
            <ChannelAnalytics />
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
      <Route path="/privacy" element={<Privacy />} />
      <Route 
        path="/ai-test" 
        element={
          <AuthGuard>
            {React.createElement(React.lazy(() => import('@/pages/AIComparisonTest')))}
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
