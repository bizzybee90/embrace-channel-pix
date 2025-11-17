import { AuthGuard } from "@/components/AuthGuard";
import Dashboard from "./Dashboard";

const Index = () => {
  return (
    <AuthGuard>
      <Dashboard />
    </AuthGuard>
  );
};

export default Index;