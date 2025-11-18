import { Inbox, AlertTriangle, CheckCircle2, Clock, Filter } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { TeamStatus } from './TeamStatus';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

export const Sidebar = () => {
  return (
    <div className="flex flex-col h-full p-4">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-primary">🐝 BizzyBee</h1>
        <p className="text-sm text-muted-foreground">Escalation Hub</p>
      </div>

      <nav className="space-y-1 mb-6">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Views
        </h2>
        <NavLink
          to="/"
          end
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
          activeClassName="bg-accent text-accent-foreground font-medium"
        >
          <Inbox className="h-4 w-4" />
          My Tickets
        </NavLink>
        <NavLink
          to="/unassigned"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
          activeClassName="bg-accent text-accent-foreground font-medium"
        >
          <AlertTriangle className="h-4 w-4" />
          Unassigned
        </NavLink>
        <NavLink
          to="/sla-risk"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
          activeClassName="bg-accent text-accent-foreground font-medium"
        >
          <Clock className="h-4 w-4" />
          SLA at Risk
        </NavLink>
        <NavLink
          to="/all-open"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
          activeClassName="bg-accent text-accent-foreground font-medium"
        >
          <CheckCircle2 className="h-4 w-4" />
          All Open
        </NavLink>
      </nav>

      <Separator className="my-4" />

      <div className="mb-6">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Saved Filters
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sm"
        >
          <Filter className="h-4 w-4 mr-2" />
          High Priority
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sm"
        >
          <Filter className="h-4 w-4 mr-2" />
          VIP Customers
        </Button>
      </div>

      <Separator className="my-4" />

      <div className="flex-1 overflow-auto">
        <TeamStatus />
      </div>
    </div>
  );
};
