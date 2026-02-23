import { Home, Mail, CheckCircle2, Clock, ChevronDown, ChevronRight, ChevronLeft, Send, Inbox, BarChart3, MessageSquare, Settings, ClipboardCheck, BookOpen, Eye, FileEdit } from 'lucide-react';
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
  const [collapsed, setCollapsed] = useState(false);
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

      const [toReplyResult, doneResult, snoozedResult, reviewResult, unreadResult, draftsResult] = await Promise.all([
        // To Reply: all requiring reply
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', userData.workspace_id)
          .eq('requires_reply', true)
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
        // Unread: status = new
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', userData.workspace_id)
          .eq('requires_reply', true)
          .eq('status', 'new'),
        // Drafts: has AI draft, no final response
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', userData.workspace_id)
          .not('ai_draft_response', 'is', null)
          .is('final_response', null)
          .in('status', ['new', 'open', 'ai_handling'])
          .eq('requires_reply', true),
      ]);

      return {
        toReply: toReplyResult.count || 0,
        done: doneResult.count || 0,
        snoozed: snoozedResult.count || 0,
        review: reviewResult.count || 0,
        unread: unreadResult.count || 0,
        drafts: draftsResult.count || 0,
        workspaceId: userData.workspace_id,
      };
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const viewCounts = viewData;

  return (
    <TooltipProvider>
      <div className={`flex flex-col h-full overflow-y-auto transition-all duration-300 relative ${isCollapsed ? 'w-[80px] p-1.5' : isMobileDrawer ? '' : 'w-60 p-4'}`}>
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
          <NavLink
            to="/"
            end
            onClick={onNavigate}
            className={`flex items-center ${isCollapsed ? 'flex-col justify-center gap-0.5 py-2 px-1' : 'gap-3 px-3 py-2.5'} rounded-xl text-sm text-foreground hover:bg-accent/50 transition-all`}
            activeClassName="bg-purple-50 text-purple-700 rounded-xl"
          >
            <Home className="h-5 w-5 text-slate-500" />
            {isCollapsed ? (
              <span className="text-[9px] text-muted-foreground leading-none">Home</span>
            ) : (
              <span>Home</span>
            )}
          </NavLink>

          {/* Inbox (To Reply) */}
          <NavLink
            to="/to-reply"
            onClick={onNavigate}
            className={`flex items-center ${isCollapsed ? 'flex-col justify-center gap-0.5 py-2 px-1' : 'gap-3 px-3 py-2.5'} rounded-xl text-sm text-foreground hover:bg-accent/50 transition-all`}
            activeClassName="bg-purple-50 text-purple-700 rounded-xl"
          >
            <div className="relative">
              <Inbox className="h-5 w-5 text-slate-500" />
              {isCollapsed && viewCounts?.toReply ? (
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5 leading-none">
                  {viewCounts.toReply > 99 ? '99+' : viewCounts.toReply}
                </span>
              ) : null}
            </div>
            {isCollapsed ? (
              <span className="text-[9px] text-muted-foreground leading-none">Inbox</span>
            ) : (
              <span className="flex-1 flex items-center justify-between">
                <span>Inbox</span>
                {viewCounts?.toReply ? (
                  <span className="text-xs font-semibold text-purple-600">{viewCounts.toReply}</span>
                ) : null}
              </span>
            )}
          </NavLink>

          {/* Unread */}
          <NavLink
            to="/unread"
            onClick={onNavigate}
            className={`flex items-center ${isCollapsed ? 'flex-col justify-center gap-0.5 py-2 px-1' : 'gap-3 px-3 py-2.5'} rounded-xl text-sm text-foreground hover:bg-accent/50 transition-all`}
            activeClassName="bg-purple-50 text-purple-700 rounded-xl"
          >
            <div className="relative">
              <Eye className="h-5 w-5 text-slate-500" />
              {isCollapsed && viewCounts?.unread ? (
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5 leading-none">
                  {viewCounts.unread > 99 ? '99+' : viewCounts.unread}
                </span>
              ) : null}
            </div>
            {isCollapsed ? (
              <span className="text-[9px] text-muted-foreground leading-none">Unread</span>
            ) : (
              <span className="flex-1 flex items-center justify-between">
                <span>Unread</span>
                {viewCounts?.unread ? (
                  <span className="text-xs font-semibold text-purple-600">{viewCounts.unread}</span>
                ) : null}
              </span>
            )}
          </NavLink>

          {/* Drafts */}
          <NavLink
            to="/drafts"
            onClick={onNavigate}
            className={`flex items-center ${isCollapsed ? 'flex-col justify-center gap-0.5 py-2 px-1' : 'gap-3 px-3 py-2.5'} rounded-xl text-sm text-foreground hover:bg-accent/50 transition-all`}
            activeClassName="bg-purple-50 text-purple-700 rounded-xl"
          >
            <div className="relative">
              <FileEdit className="h-5 w-5 text-slate-500" />
              {isCollapsed && viewCounts?.drafts ? (
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5 leading-none">
                  {viewCounts.drafts > 99 ? '99+' : viewCounts.drafts}
                </span>
              ) : null}
            </div>
            {isCollapsed ? (
              <span className="text-[9px] text-muted-foreground leading-none">Drafts</span>
            ) : (
              <span className="flex-1 flex items-center justify-between">
                <span>Drafts</span>
                {viewCounts?.drafts ? (
                  <span className="text-xs font-semibold text-purple-600">{viewCounts.drafts}</span>
                ) : null}
              </span>
            )}
          </NavLink>

          {/* Training */}
          <NavLink
            to="/review"
            onClick={onNavigate}
            className={`flex items-center ${isCollapsed ? 'flex-col justify-center gap-0.5 py-2 px-1' : 'gap-3 px-3 py-2.5'} rounded-xl text-sm text-foreground hover:bg-accent/50 transition-all`}
            activeClassName="bg-purple-50 text-purple-700 rounded-xl"
          >
            <ClipboardCheck className="h-5 w-5 text-slate-500" />
            {isCollapsed ? (
              <span className="text-[9px] text-muted-foreground leading-none">Train</span>
            ) : (
              <span className="flex-1 flex items-center justify-between">
                <span>Training</span>
                {viewCounts?.review ? (
                  <span className="text-xs font-semibold text-purple-600">{viewCounts.review}</span>
                ) : null}
              </span>
            )}
          </NavLink>

          {/* Snoozed */}
          <NavLink
            to="/snoozed"
            onClick={onNavigate}
            className={`flex items-center ${isCollapsed ? 'flex-col justify-center gap-0.5 py-2 px-1' : 'gap-3 px-3 py-2.5'} rounded-xl text-sm text-foreground hover:bg-accent/50 transition-all`}
            activeClassName="bg-purple-50 text-purple-700 rounded-xl"
          >
            <Clock className="h-5 w-5 text-slate-500" />
            {isCollapsed ? (
              <span className="text-[9px] text-muted-foreground leading-none">Snooze</span>
            ) : (
              <span className="flex-1 flex items-center justify-between">
                <span>Snoozed</span>
                {viewCounts?.snoozed ? (
                  <span className="text-xs text-muted-foreground">{viewCounts.snoozed}</span>
                ) : null}
              </span>
            )}
          </NavLink>

          {/* Done */}
          <NavLink
            to="/done"
            onClick={onNavigate}
            className={`flex items-center ${isCollapsed ? 'flex-col justify-center gap-0.5 py-2 px-1' : 'gap-3 px-3 py-2.5'} rounded-xl text-sm text-foreground hover:bg-accent/50 transition-all`}
            activeClassName="bg-purple-50 text-purple-700 rounded-xl"
          >
            <CheckCircle2 className="h-5 w-5 text-slate-500" />
            {isCollapsed ? (
              <span className="text-[9px] text-muted-foreground leading-none">Done</span>
            ) : (
              <span className="flex-1 flex items-center justify-between">
                <span>Done</span>
                {viewCounts?.done ? (
                  <span className="text-xs text-muted-foreground">{viewCounts.done}</span>
                ) : null}
              </span>
            )}
          </NavLink>

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
                  className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                  activeClassName="bg-purple-50 text-purple-700 rounded-xl"
                >
                  <Send className="h-4 w-4" />
                  <span>Sent</span>
                </NavLink>
                <NavLink
                  to="/all-open"
                  onClick={onNavigate}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                  activeClassName="bg-purple-50 text-purple-700 rounded-xl"
                >
                  <Inbox className="h-4 w-4" />
                  <span>Inbox (All)</span>
                </NavLink>
                <NavLink
                  to="/channels"
                  onClick={onNavigate}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                  activeClassName="bg-purple-50 text-purple-700 rounded-xl"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span>Channels</span>
                </NavLink>
                <NavLink
                  to="/analytics"
                  onClick={onNavigate}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                  activeClassName="bg-purple-50 text-purple-700 rounded-xl"
                >
                  <BarChart3 className="h-4 w-4" />
                  <span>Analytics</span>
                </NavLink>
                <NavLink
                  to="/knowledge-base"
                  onClick={onNavigate}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                  activeClassName="bg-purple-50 text-purple-700 rounded-xl"
                >
                  <BookOpen className="h-4 w-4" />
                  <span>Knowledge Base</span>
                </NavLink>
                <NavLink
                  to="/settings"
                  onClick={onNavigate}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                  activeClassName="bg-purple-50 text-purple-700 rounded-xl"
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
              <NavLink
                to="/sent"
                onClick={onNavigate}
                className="flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl text-sm text-foreground hover:bg-accent/50 transition-all"
                activeClassName="bg-purple-50 text-purple-700 rounded-xl"
              >
                <Send className="h-5 w-5 text-slate-500" />
                <span className="text-[9px] text-muted-foreground leading-none">Sent</span>
              </NavLink>
              <NavLink
                to="/settings"
                onClick={onNavigate}
                className="flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl text-sm text-foreground hover:bg-accent/50 transition-all"
                activeClassName="bg-purple-50 text-purple-700 rounded-xl"
              >
                <Settings className="h-5 w-5 text-muted-foreground" />
                <span className="text-[9px] text-muted-foreground leading-none">Settings</span>
              </NavLink>
            </div>
          )}
        </nav>
      </div>
    </TooltipProvider>
  );
};
