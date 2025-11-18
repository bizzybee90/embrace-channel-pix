import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Dashboard from "./pages/Dashboard";
import { EscalationHub } from "./pages/EscalationHub";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<EscalationHub filter="all-open" />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/unassigned" element={<EscalationHub filter="unassigned" />} />
          <Route path="/sla-risk" element={<EscalationHub filter="sla-risk" />} />
          <Route path="/all-open" element={<EscalationHub filter="all-open" />} />
          <Route path="/auth" element={<Auth />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
