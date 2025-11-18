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
import beeLogo from '@/assets/bee-logo.png';

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
      <div className="mb-6 flex items-center gap-3">
        <div className="flex-shrink-0">
          <img src={beeLogo} alt="BizzyBee Logo" className="h-10 w-10 rounded-lg" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-primary">BizzyBee</h1>
          <p className="text-sm text-muted-foreground">Escalation Hub</p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
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
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          Views
        </h2>
        {visibleFilters.myTickets && (
          <NavLink
            to="/"
            end
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-accent/50 transition-all hover-scale"
            activeClassName="bg-accent text-accent-foreground font-medium shadow-sm"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
              <Inbox className="h-4 w-4 text-primary" />
            </div>
            <span>My Tickets</span>
          </NavLink>
        )}
        {visibleFilters.unassigned && (
          <NavLink
            to="/unassigned"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-accent/50 transition-all hover-scale"
            activeClassName="bg-accent text-accent-foreground font-medium shadow-sm"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-destructive/10">
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </div>
            <span>Unassigned</span>
          </NavLink>
        )}
        {visibleFilters.slaRisk && (
          <NavLink
            to="/sla-risk"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-accent/50 transition-all hover-scale"
            activeClassName="bg-accent text-accent-foreground font-medium shadow-sm"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-orange-500/10">
              <Clock className="h-4 w-4 text-orange-500" />
            </div>
            <span>SLA at Risk</span>
          </NavLink>
        )}
        {visibleFilters.allOpen && (
          <NavLink
            to="/all-open"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-accent/50 transition-all hover-scale"
            activeClassName="bg-accent text-accent-foreground font-medium shadow-sm"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </div>
            <span>All Open</span>
          </NavLink>
        )}
      </nav>

      <Separator className="my-4" />

      <div className="mb-6">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
          Saved Filters
        </h2>
        <div className="space-y-1">
          <Button variant="ghost" className="w-full justify-start gap-3 px-3 py-2.5 h-auto hover-scale">
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-blue-500/10">
              <Zap className="h-4 w-4 text-blue-500" />
            </div>
            <span className="text-sm">High Priority</span>
          </Button>
          <Button variant="ghost" className="w-full justify-start gap-3 px-3 py-2.5 h-auto hover-scale">
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-purple-500/10">
              <Filter className="h-4 w-4 text-purple-500" />
            </div>
            <span className="text-sm">VIP Customers</span>
          </Button>
        </div>
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
