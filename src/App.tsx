import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import React from "react";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import WebhookLogs from "./pages/WebhookLogs";
import Privacy from "./pages/Privacy";
import Escalations from "./pages/Escalations";
import { EscalationHub } from "./pages/EscalationHub";
import { MobileEscalationHub } from "./pages/mobile/MobileEscalationHub";
import ConversationView from "./pages/ConversationView";
import { AuthGuard } from "./components/AuthGuard";
import { useIsMobile } from "./hooks/use-mobile";
import Home from "./pages/Home";
import ChannelsDashboard from "./pages/ChannelsDashboard";
import ChannelConversations from "./pages/ChannelConversations";
import AnalyticsDashboard from "./pages/AnalyticsDashboard";
import Review from "./pages/Review";
import ActivityPage from "./pages/ActivityPage";


const queryClient = new QueryClient();

const RouterContent = () => {
  const isMobile = useIsMobile();

  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      
      {/* Home - Calm reassurance screen */}
      <Route 
        path="/" 
        element={
          <AuthGuard>
            <Home />
          </AuthGuard>
        } 
      />
      
      {/* To Reply - Primary view (renamed from needs-me) */}
      <Route 
        path="/to-reply" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="needs-me" />
            ) : (
              <EscalationHub filter="needs-me" />
            )}
          </AuthGuard>
        } 
      />
      
      {/* Redirect old needs-me route */}
      <Route path="/needs-me" element={<Navigate to="/to-reply" replace />} />
      
      {/* FYI - Redirect to To Reply (removed view) */}
      <Route path="/fyi" element={<Navigate to="/to-reply" replace />} />
      
      {/* Done - Auto-handled + resolved (renamed from cleared) */}
      <Route 
        path="/done" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="cleared" />
            ) : (
              <EscalationHub filter="cleared" />
            )}
          </AuthGuard>
        } 
      />
      
      {/* Redirect old cleared route */}
      <Route path="/cleared" element={<Navigate to="/done" replace />} />
      
      {/* Review - Reconciliation flow */}
      <Route 
        path="/review" 
        element={
          <AuthGuard>
            <Review />
          </AuthGuard>
        } 
      />
      
      {/* Snoozed */}
      <Route 
        path="/snoozed" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="snoozed" />
            ) : (
              <EscalationHub filter="snoozed" />
            )}
          </AuthGuard>
        } 
      />
      
      {/* Sent */}
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
      
      {/* All Open (Inbox All) - Hidden under More */}
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
      
      {/* Legacy routes - redirect or keep for backwards compatibility */}
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
        path="/completed" 
        element={<Navigate to="/done" replace />}
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
        path="/triaged" 
        element={
          <AuthGuard>
            {isMobile ? (
              <MobileEscalationHub filter="triaged" />
            ) : (
              <EscalationHub filter="triaged" />
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
            <AnalyticsDashboard />
          </AuthGuard>
        } 
      />

      {/* Activity Page - Full activity timeline */}
      <Route 
        path="/activity" 
        element={
          <AuthGuard>
            <ActivityPage />
          </AuthGuard>
        }
      />

      <Route
        path="/conversation/:id"
        element={
          <AuthGuard>
            <ConversationView />
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
