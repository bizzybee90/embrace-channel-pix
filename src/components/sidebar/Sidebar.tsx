import { Inbox, AlertTriangle, CheckCircle2, Clock, Filter, Zap, Columns, Settings } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { TeamStatus } from './TeamStatus';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useInterfaceMode } from '@/hooks/useInterfaceMode';
import { Card } from '@/components/ui/card';
import { useState, useEffect } from 'react';

export const Sidebar = () => {
  const { interfaceMode, toggleMode, loading } = useInterfaceMode();
  const [visibleFilters, setVisibleFilters] = useState({
    myTickets: true,
    unassigned: true,
    slaRisk: true,
    allOpen: true,
  });

  useEffect(() => {
    const saved = localStorage.getItem('visibleFilters');
    if (saved) {
      setVisibleFilters(JSON.parse(saved));
    }
  }, []);

  const toggleFilter = (filter: keyof typeof visibleFilters) => {
    const updated = { ...visibleFilters, [filter]: !visibleFilters[filter] };
    setVisibleFilters(updated);
    localStorage.setItem('visibleFilters', JSON.stringify(updated));
  };
  return (
    <div className="flex flex-col h-full p-4">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary">🐝 BizzyBee</h1>
          <p className="text-sm text-muted-foreground">Escalation Hub</p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Settings className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="end">
            <div className="space-y-4">
              <h3 className="font-semibold">Filter Visibility</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="my-tickets">My Tickets</Label>
                  <Switch
                    id="my-tickets"
                    checked={visibleFilters.myTickets}
                    onCheckedChange={() => toggleFilter('myTickets')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="unassigned">Unassigned</Label>
                  <Switch
                    id="unassigned"
                    checked={visibleFilters.unassigned}
                    onCheckedChange={() => toggleFilter('unassigned')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="sla-risk">SLA at Risk</Label>
                  <Switch
                    id="sla-risk"
                    checked={visibleFilters.slaRisk}
                    onCheckedChange={() => toggleFilter('slaRisk')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="all-open">All Open</Label>
                  <Switch
                    id="all-open"
                    checked={visibleFilters.allOpen}
                    onCheckedChange={() => toggleFilter('allOpen')}
                  />
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <nav className="space-y-1 mb-6">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Views
        </h2>
        {visibleFilters.myTickets && (
          <NavLink
            to="/"
            end
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
            activeClassName="bg-accent text-accent-foreground font-medium"
          >
            <Inbox className="h-4 w-4" />
            My Tickets
          </NavLink>
        )}
        {visibleFilters.unassigned && (
          <NavLink
            to="/unassigned"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
            activeClassName="bg-accent text-accent-foreground font-medium"
          >
            <AlertTriangle className="h-4 w-4" />
            Unassigned
          </NavLink>
        )}
        {visibleFilters.slaRisk && (
          <NavLink
            to="/sla-risk"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
            activeClassName="bg-accent text-accent-foreground font-medium"
          >
            <Clock className="h-4 w-4" />
            SLA at Risk
          </NavLink>
        )}
        {visibleFilters.allOpen && (
          <NavLink
            to="/all-open"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors"
            activeClassName="bg-accent text-accent-foreground font-medium"
          >
            <CheckCircle2 className="h-4 w-4" />
            All Open
          </NavLink>
        )}
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

      <Separator className="my-4" />

      {/* Interface Mode Toggle */}
      {!loading && (
        <Card className="p-3 bg-muted/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Interface</span>
          </div>
          <Button
            variant={interfaceMode === 'focus' ? 'default' : 'outline'}
            size="sm"
            className="w-full justify-start mb-1"
            onClick={() => interfaceMode === 'power' && toggleMode()}
          >
            <Zap className="h-3 w-3 mr-2" />
            <span className="text-xs">Focus Mode</span>
          </Button>
          <Button
            variant={interfaceMode === 'power' ? 'default' : 'outline'}
            size="sm"
            className="w-full justify-start"
            onClick={() => interfaceMode === 'focus' && toggleMode()}
          >
            <Columns className="h-3 w-3 mr-2" />
            <span className="text-xs">Power Mode</span>
          </Button>
        </Card>
      )}
    </div>
  );
};
