import { Home, Mail, CheckCircle2, Clock, ChevronDown, ChevronRight, ChevronLeft, Send, Inbox, BarChart3, MessageSquare, Settings, ClipboardCheck } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import bizzybeelogo from '@/assets/bizzybee-logo.png';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { EmailImportIndicator } from './EmailImportIndicator';
interface SidebarProps {
  forceCollapsed?: boolean;
  onNavigate?: () => void;
  onFiltersClick?: () => void;
  isMobileDrawer?: boolean;
}

export const Sidebar = ({ forceCollapsed = false, onNavigate, onFiltersClick, isMobileDrawer = false }: SidebarProps = {}) => {
  const [collapsed, setCollapsed] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  
  // In mobile drawer mode, never collapse - always show full sidebar with labels
  const isCollapsed = isMobileDrawer ? false : (forceCollapsed || collapsed);

  // Fetch view counts and workspace ID
  const { data: viewData } = useQuery({
    queryKey: ['sidebar-view-counts'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { toReply: 0, done: 0, snoozed: 0, review: 0, workspaceId: null };

      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .single();

      if (!userData?.workspace_id) return { toReply: 0, done: 0, snoozed: 0, review: 0, workspaceId: null };

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [toReplyResult, doneResult, snoozedResult, reviewResult] = await Promise.all([
        // To Reply: act_now + quick_win
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', userData.workspace_id)
          .in('decision_bucket', ['act_now', 'quick_win'])
          .in('status', ['new', 'open', 'waiting_internal', 'ai_handling', 'escalated']),
        // Done: auto_handled or resolved (last 24h)
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', userData.workspace_id)
          .or('decision_bucket.eq.auto_handled,status.eq.resolved')
          .gte('updated_at', today.toISOString()),
        // Snoozed
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', userData.workspace_id)
          .not('snoozed_until', 'is', null)
          .gt('snoozed_until', new Date().toISOString()),
        // Review: needs_review and not yet reviewed
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', userData.workspace_id)
          .eq('needs_review', true)
          .is('reviewed_at', null),
      ]);

      return {
        toReply: toReplyResult.count || 0,
        done: doneResult.count || 0,
        snoozed: snoozedResult.count || 0,
        review: reviewResult.count || 0,
        workspaceId: userData.workspace_id,
      };
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const viewCounts = viewData;

  return (
    <TooltipProvider>
      <div className={`flex flex-col h-full overflow-y-auto transition-all duration-300 relative ${isCollapsed ? 'w-[72px] p-1.5' : isMobileDrawer ? '' : 'w-60 p-4'}`}>
        {/* Collapse Toggle */}
        {!forceCollapsed && !isMobileDrawer && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className={`absolute top-4 z-10 h-8 w-8 bg-background/95 backdrop-blur hover:bg-accent transition-all duration-300 ${isCollapsed ? 'left-1/2 -translate-x-1/2' : 'right-2'}`}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        )}

        {/* Logo Section */}
        <div className={`flex items-center ${isCollapsed ? 'justify-center mt-14 mb-2' : isMobileDrawer ? 'gap-3 mb-6' : 'gap-3 mb-6 mt-0'}`}>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex-shrink-0 cursor-pointer hover:scale-110 transition-transform">
                  <img 
                    src={bizzybeelogo} 
                    alt="BizzyBee" 
                    className="h-12 w-12 object-contain"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-semibold">BizzyBee</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <img 
              src={bizzybeelogo} 
              alt="BizzyBee" 
              className="h-44 w-auto"
            />
          )}
        </div>

        {/* Primary Navigation - Clean label style */}
        <nav className="space-y-1 flex-1">
          {/* Home */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <NavLink
                  to="/"
                  end
                  onClick={onNavigate}
                  className={`flex items-center ${isCollapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2.5'} rounded-lg text-sm text-foreground hover:bg-accent/50 transition-all`}
                  activeClassName="bg-accent text-accent-foreground font-medium"
                >
                  <Home className="h-5 w-5 text-muted-foreground" />
                  {!isCollapsed && <span>Home</span>}
                </NavLink>
              </div>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">
                <p>Home</p>
              </TooltipContent>
            )}
          </Tooltip>

          {/* To Reply (Primary) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <NavLink
                  to="/to-reply"
                  onClick={onNavigate}
                  className={`flex items-center ${isCollapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2.5'} rounded-lg text-sm text-foreground hover:bg-accent/50 transition-all`}
                  activeClassName="bg-accent text-accent-foreground font-medium"
                >
                  <Mail className="h-5 w-5 text-destructive" />
                  {!isCollapsed && (
                    <span className="flex-1 flex items-center justify-between">
                      <span>To Reply</span>
                      {viewCounts?.toReply ? (
                        <span className="text-xs font-semibold text-destructive">{viewCounts.toReply}</span>
                      ) : null}
                    </span>
                  )}
                </NavLink>
              </div>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">
                <p>To Reply {viewCounts?.toReply ? `(${viewCounts.toReply})` : ''}</p>
              </TooltipContent>
            )}
          </Tooltip>

          {/* Training - Help BizzyBee learn */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <NavLink
                  to="/review"
                  onClick={onNavigate}
                  className={`flex items-center ${isCollapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2.5'} rounded-lg text-sm text-foreground hover:bg-accent/50 transition-all`}
                  activeClassName="bg-accent text-accent-foreground font-medium"
                >
                  <ClipboardCheck className="h-5 w-5 text-purple-500" />
                  {!isCollapsed && (
                    <span className="flex-1 flex items-center justify-between">
                      <span>Training</span>
                      {viewCounts?.review ? (
                        <span className="text-xs font-semibold text-purple-500">{viewCounts.review}</span>
                      ) : null}
                    </span>
                  )}
                </NavLink>
              </div>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">
                <p>Training {viewCounts?.review ? `(${viewCounts.review})` : ''}</p>
              </TooltipContent>
            )}
          </Tooltip>

          {/* Snoozed */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <NavLink
                  to="/snoozed"
                  onClick={onNavigate}
                  className={`flex items-center ${isCollapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2.5'} rounded-lg text-sm text-foreground hover:bg-accent/50 transition-all`}
                  activeClassName="bg-accent text-accent-foreground font-medium"
                >
                  <Clock className="h-5 w-5 text-amber-500" />
                  {!isCollapsed && (
                    <span className="flex-1 flex items-center justify-between">
                      <span>Snoozed</span>
                      {viewCounts?.snoozed ? (
                        <span className="text-xs text-muted-foreground">{viewCounts.snoozed}</span>
                      ) : null}
                    </span>
                  )}
                </NavLink>
              </div>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">
                <p>Snoozed {viewCounts?.snoozed ? `(${viewCounts.snoozed})` : ''}</p>
              </TooltipContent>
            )}
          </Tooltip>

          {/* Done */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <NavLink
                  to="/done"
                  onClick={onNavigate}
                  className={`flex items-center ${isCollapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2.5'} rounded-lg text-sm text-foreground hover:bg-accent/50 transition-all`}
                  activeClassName="bg-accent text-accent-foreground font-medium"
                >
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  {!isCollapsed && (
                    <span className="flex-1 flex items-center justify-between">
                      <span>Done</span>
                      {viewCounts?.done ? (
                        <span className="text-xs text-muted-foreground">{viewCounts.done}</span>
                      ) : null}
                    </span>
                  )}
                </NavLink>
              </div>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">
                <p>Done {viewCounts?.done ? `(${viewCounts.done})` : ''}</p>
              </TooltipContent>
            )}
          </Tooltip>

          {/* Email Import Progress Indicator */}
          <EmailImportIndicator workspaceId={viewData?.workspaceId || null} isCollapsed={isCollapsed} />

          {/* More Section - Collapsible */}
          {!isCollapsed && (
            <Collapsible open={moreOpen} onOpenChange={setMoreOpen} className="mt-4">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-between px-3 py-2.5 h-auto text-sm text-muted-foreground hover:text-foreground"
                >
                  <span>More</span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 pt-1">
                <NavLink
                  to="/sent"
                  onClick={onNavigate}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                  activeClassName="bg-accent text-accent-foreground font-medium"
                >
                  <Send className="h-4 w-4" />
                  <span>Sent</span>
                </NavLink>
                <NavLink
                  to="/all-open"
                  onClick={onNavigate}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                  activeClassName="bg-accent text-accent-foreground font-medium"
                >
                  <Inbox className="h-4 w-4" />
                  <span>Inbox (All)</span>
                </NavLink>
                <NavLink
                  to="/channels"
                  onClick={onNavigate}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                  activeClassName="bg-accent text-accent-foreground font-medium"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span>Channels</span>
                </NavLink>
                <NavLink
                  to="/analytics"
                  onClick={onNavigate}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                  activeClassName="bg-accent text-accent-foreground font-medium"
                >
                  <BarChart3 className="h-4 w-4" />
                  <span>Analytics</span>
                </NavLink>
                <NavLink
                  to="/settings"
                  onClick={onNavigate}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                  activeClassName="bg-accent text-accent-foreground font-medium"
                >
                  <Settings className="h-4 w-4" />
                  <span>Settings</span>
                </NavLink>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Collapsed More Icons */}
          {isCollapsed && (
            <div className="space-y-1 pt-4 border-t border-border/50 mt-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NavLink
                      to="/sent"
                      onClick={onNavigate}
                      className="flex items-center justify-center p-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                      activeClassName="bg-accent text-accent-foreground"
                    >
                      <Send className="h-5 w-5" />
                    </NavLink>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Sent</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <NavLink
                      to="/settings"
                      onClick={onNavigate}
                      className="flex items-center justify-center p-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                      activeClassName="bg-accent text-accent-foreground"
                    >
                      <Settings className="h-5 w-5" />
                    </NavLink>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Settings</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </nav>
      </div>
    </TooltipProvider>
  );
};
