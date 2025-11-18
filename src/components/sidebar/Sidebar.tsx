import { Inbox, AlertTriangle, CheckCircle2, Clock, Filter, Zap, Columns, Settings, ChevronRight, PanelLeftClose } from 'lucide-react';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export const Sidebar = () => {
  const { interfaceMode, toggleMode, loading } = useInterfaceMode();
  const [collapsed, setCollapsed] = useState(false);
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
    <TooltipProvider>
      <div className={`flex flex-col h-full p-4 transition-all duration-300 relative ${collapsed ? 'w-16' : 'w-60'}`}>
        {/* Collapse Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className={`absolute top-4 z-10 h-8 w-8 bg-background/95 backdrop-blur hover:bg-accent transition-all duration-300 ${collapsed ? 'left-2' : 'right-2'}`}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>

        {/* Logo Section */}
        <div className={`mb-6 flex items-center ${collapsed ? 'justify-center mt-14' : 'gap-3 mt-0'}`}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex-shrink-0 cursor-pointer">
                  <img src={beeLogo} alt="BizzyBee Logo" className="h-10 w-10 rounded-lg hover:scale-110 transition-transform" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-semibold">BizzyBee</p>
                <p className="text-xs text-muted-foreground">Escalation Hub</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
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
          </>
          )}
        </div>

        <nav className="space-y-1 mb-6">
          {!collapsed && (
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
              Views
            </h2>
          )}
          {visibleFilters.myTickets && (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to="/"
                  end
                  className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm hover:bg-accent/50 transition-all hover-scale`}
                  activeClassName="bg-accent text-accent-foreground font-medium shadow-sm"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
                    <Inbox className="h-4 w-4 text-primary" />
                  </div>
                  {!collapsed && <span>My Tickets</span>}
                </NavLink>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  <p>My Tickets</p>
                </TooltipContent>
              )}
            </Tooltip>
          )}
          {visibleFilters.unassigned && (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to="/unassigned"
                  className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm hover:bg-accent/50 transition-all hover-scale`}
                  activeClassName="bg-accent text-accent-foreground font-medium shadow-sm"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-destructive/10">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  </div>
                  {!collapsed && <span>Unassigned</span>}
                </NavLink>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  <p>Unassigned</p>
                </TooltipContent>
              )}
            </Tooltip>
          )}
          {visibleFilters.slaRisk && (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to="/sla-risk"
                  className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm hover:bg-accent/50 transition-all hover-scale`}
                  activeClassName="bg-accent text-accent-foreground font-medium shadow-sm"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-orange-500/10">
                    <Clock className="h-4 w-4 text-orange-500" />
                  </div>
                  {!collapsed && <span>SLA at Risk</span>}
                </NavLink>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  <p>SLA at Risk</p>
                </TooltipContent>
              )}
            </Tooltip>
          )}
          {visibleFilters.allOpen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to="/all-open"
                  className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm hover:bg-accent/50 transition-all hover-scale`}
                  activeClassName="bg-accent text-accent-foreground font-medium shadow-sm"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-green-500/10">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  </div>
                  {!collapsed && <span>All Open</span>}
                </NavLink>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  <p>All Open</p>
                </TooltipContent>
              )}
            </Tooltip>
          )}
        </nav>

        <Separator className="my-4" />

        <div className="mb-6">
          {!collapsed && (
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
              Saved Filters
            </h2>
          )}
          <div className="space-y-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" className={`w-full ${collapsed ? 'justify-center px-2' : 'justify-start gap-3 px-3'} py-2.5 h-auto hover-scale`}>
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-blue-500/10">
                    <Zap className="h-4 w-4 text-blue-500" />
                  </div>
                  {!collapsed && <span className="text-sm">High Priority</span>}
                </Button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  <p>High Priority</p>
                </TooltipContent>
              )}
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" className={`w-full ${collapsed ? 'justify-center px-2' : 'justify-start gap-3 px-3'} py-2.5 h-auto hover-scale`}>
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-purple-500/10">
                    <Filter className="h-4 w-4 text-purple-500" />
                  </div>
                  {!collapsed && <span className="text-sm">VIP Customers</span>}
                </Button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">
                  <p>VIP Customers</p>
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </div>

        <Separator className="my-4" />

        {!collapsed && (
          <div className="flex-1 overflow-auto">
            <TeamStatus />
          </div>
        )}

        <Separator className="my-4" />

        {/* Interface Mode Toggle */}
        {!loading && (
          <Card className="p-3 bg-muted/50">
            {!collapsed && (
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Interface</span>
              </div>
            )}
            {collapsed ? (
              <div className="flex flex-col gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={interfaceMode === 'focus' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => interfaceMode === 'power' && toggleMode()}
                    >
                      <Zap className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>Focus Mode</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={interfaceMode === 'power' ? 'default' : 'ghost'}
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => interfaceMode === 'focus' && toggleMode()}
                    >
                      <Columns className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>Power Mode</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <>
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
              </>
            )}
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
};
