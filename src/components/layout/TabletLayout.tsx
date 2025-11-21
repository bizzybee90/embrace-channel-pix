import { useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ConversationThread } from '@/components/conversations/ConversationThread';
import { Conversation } from '@/lib/types';
import { User, Zap, Inbox } from 'lucide-react';
import { SLABadge } from '@/components/sla/SLABadge';
import { Badge } from '@/components/ui/badge';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, Clock, UserPlus, AlertCircle, Mail, Phone, Tag } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { SnoozeDialog } from '@/components/conversations/SnoozeDialog';

interface TabletLayoutProps {
  filter?: 'my-tickets' | 'unassigned' | 'sla-risk' | 'all-open';
}

export const TabletLayout = ({ filter = 'all-open' }: TabletLayoutProps) => {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [drawerMode, setDrawerMode] = useState<'customer' | 'actions' | null>(null);
  const [snoozeDialogOpen, setSnoozeDialogOpen] = useState(false);
  const { toast } = useToast();

  const handleUpdate = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleSelectConversation = (conv: Conversation) => {
    setSelectedConversation(conv);
    setDrawerMode(null);
  };

  const getFilterTitle = () => {
    switch (filter) {
      case 'my-tickets': return 'My Tickets';
      case 'unassigned': return 'Unassigned';
      case 'sla-risk': return 'SLA Risk';
      case 'all-open': return 'All Open';
      default: return 'Conversations';
    }
  };

  const handleResolve = async () => {
    if (!selectedConversation) return;
    await supabase
      .from('conversations')
      .update({ 
        status: 'resolved',
        resolved_at: new Date().toISOString()
      })
      .eq('id', selectedConversation.id);
    
    toast({ title: "Conversation resolved" });
    handleUpdate();
  };

  const handleAssignToMe = async () => {
    if (!selectedConversation) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('conversations')
      .update({ assigned_to: user.id })
      .eq('id', selectedConversation.id);
    
    toast({ title: "Assigned to you" });
    handleUpdate();
  };

  const handlePriorityChange = async (priority: string) => {
    if (!selectedConversation) return;
    await supabase
      .from('conversations')
      .update({ priority })
      .eq('id', selectedConversation.id);
    
    toast({ title: `Priority changed to ${priority}` });
    handleUpdate();
  };

  // Professional 3-column tablet layout
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Column 1: Collapsed Sidebar (72px) */}
      <div className="flex-shrink-0 border-r border-border/40 bg-card shadow-sm">
        <Sidebar forceCollapsed />
      </div>

      {/* Column 2: Ticket List (32-36% width) */}
      <div className="w-[34%] flex-shrink-0 border-r border-border/40 bg-background flex flex-col">
        {/* Header */}
        <div className="px-4 py-4 border-b border-border/30 bg-card/30">
          <h2 className="text-xl font-bold text-foreground mb-1">{getFilterTitle()}</h2>
          <p className="text-xs text-muted-foreground">Support escalations</p>
        </div>

        {/* Ticket List - scrollable */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <ConversationList
            selectedId={selectedConversation?.id}
            onSelect={handleSelectConversation}
            filter={filter}
            key={refreshKey}
          />
        </div>
      </div>

      {/* Column 3: Conversation Panel (64-68% width) */}
      <div className="flex-1 bg-muted/20 flex flex-col overflow-hidden">
        {selectedConversation ? (
          <>
            {/* Unified Header Card */}
            <div className="mx-6 mt-6 mb-4 rounded-2xl bg-card shadow-md border border-border/50 overflow-hidden">
              {/* Title Row */}
              <div className="px-6 py-5 border-b border-border/30">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <h1 className="text-2xl font-bold leading-tight flex-1 min-w-0">
                    {selectedConversation.title}
                  </h1>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {selectedConversation.sla_due_at && (
                      <SLABadge conversation={selectedConversation} />
                    )}
                    {selectedConversation.priority && (
                      <Badge variant={`priority-${selectedConversation.priority}` as any} className="text-sm px-3 py-1">
                        {selectedConversation.priority === 'high' ? '🔴' : selectedConversation.priority === 'medium' ? '🟡' : '🟢'}
                        {selectedConversation.priority}
                      </Badge>
                    )}
                  </div>
                </div>
                
                {/* Pill Button Row */}
                <div className="flex gap-3">
                  <Button
                    onClick={() => setDrawerMode(drawerMode === 'customer' ? null : 'customer')}
                    variant={drawerMode === 'customer' ? 'default' : 'outline'}
                    className="rounded-full px-5 py-2 h-auto font-semibold transition-all"
                  >
                    <User className="h-4 w-4 mr-2" />
                    Customer Info
                  </Button>
                  <Button
                    onClick={() => setDrawerMode(drawerMode === 'actions' ? null : 'actions')}
                    variant={drawerMode === 'actions' ? 'default' : 'outline'}
                    className="rounded-full px-5 py-2 h-auto font-semibold transition-all"
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    Quick Actions
                  </Button>
                </div>
              </div>
            </div>

            {/* Conversation Thread - Scrollable */}
            <div className="flex-1 overflow-y-auto px-6">
              <ConversationThread
                conversation={selectedConversation}
                onUpdate={handleUpdate}
              />
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
            <div className="h-20 w-20 rounded-3xl bg-muted/50 flex items-center justify-center mb-6 shadow-sm">
              <Inbox className="h-10 w-10 text-muted-foreground/50" />
            </div>
            <p className="text-xl font-semibold">No conversation selected</p>
            <p className="text-sm text-muted-foreground/70 mt-2">Select a ticket from the list to view details</p>
          </div>
        )}
      </div>

      {/* Slide-in Drawer (Customer Info / Quick Actions) */}
      <Drawer open={drawerMode !== null} onOpenChange={(open) => !open && setDrawerMode(null)}>
        <DrawerContent className="h-[85vh] w-[58%] ml-auto rounded-tl-3xl rounded-bl-3xl shadow-2xl">
          {/* iOS-style drag handle */}
          <div className="w-full flex justify-center py-4">
            <div className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
          </div>

          <DrawerHeader className="px-8 pb-6">
            <DrawerTitle className="text-2xl font-bold">
              {drawerMode === 'customer' ? 'Customer Information' : 'Quick Actions'}
            </DrawerTitle>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-8 pb-8">
            {drawerMode === 'customer' && selectedConversation && (
              <div className="space-y-6">
                {/* Contact Info */}
                <div className="rounded-2xl bg-card border border-border/50 p-6 shadow-sm">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Contact Information</h3>
                  <div className="space-y-4">
                    {selectedConversation.metadata?.customer_email && (
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Mail className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground mb-1">Email</p>
                          <p className="text-base font-medium truncate">{selectedConversation.metadata.customer_email as string}</p>
                        </div>
                      </div>
                    )}
                    {selectedConversation.metadata?.customer_phone && (
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-success/10 flex items-center justify-center flex-shrink-0">
                          <Phone className="h-5 w-5 text-success" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground mb-1">Phone</p>
                          <p className="text-base font-medium">{selectedConversation.metadata.customer_phone as string}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Recent History */}
                <div className="rounded-2xl bg-card border border-border/50 p-6 shadow-sm">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Recent History</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/40">
                      <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      <p className="text-sm">Created {formatDistanceToNow(new Date(selectedConversation.created_at || ''), { addSuffix: true })}</p>
                    </div>
                    {selectedConversation.first_response_at && (
                      <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/40">
                        <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <p className="text-sm">First response {formatDistanceToNow(new Date(selectedConversation.first_response_at), { addSuffix: true })}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Category */}
                {selectedConversation.category && (
                  <div className="rounded-2xl bg-card border border-border/50 p-6 shadow-sm">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Category</h3>
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
                        <Tag className="h-5 w-5 text-accent-foreground" />
                      </div>
                      <span className="px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-semibold capitalize">
                        {selectedConversation.category}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {drawerMode === 'actions' && selectedConversation && (
              <div className="space-y-5">
                {/* Resolve Button */}
                <div className="rounded-2xl bg-card border border-border/50 p-6 shadow-sm">
                  <Button
                    onClick={handleResolve}
                    className="w-full h-14 bg-success hover:bg-success/90 text-success-foreground font-semibold rounded-xl text-base shadow-sm"
                    disabled={selectedConversation.status === 'resolved'}
                  >
                    <CheckCircle2 className="h-5 w-5 mr-3" />
                    {selectedConversation.status === 'resolved' ? 'Resolved' : 'Resolve & Close'}
                  </Button>
                </div>

                {/* Priority Selector */}
                <div className="rounded-2xl bg-card border border-border/50 p-6 shadow-sm">
                  <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 block">Change Priority</label>
                  <Select value={selectedConversation.priority || 'medium'} onValueChange={handlePriorityChange}>
                    <SelectTrigger className="h-14 rounded-xl bg-muted/50 text-base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">
                        <span className="flex items-center gap-3">
                          <AlertCircle className="h-5 w-5 text-destructive" />
                          High Priority
                        </span>
                      </SelectItem>
                      <SelectItem value="medium">
                        <span className="flex items-center gap-3">
                          <AlertCircle className="h-5 w-5 text-warning" />
                          Medium Priority
                        </span>
                      </SelectItem>
                      <SelectItem value="low">
                        <span className="flex items-center gap-3">
                          <AlertCircle className="h-5 w-5 text-muted-foreground" />
                          Low Priority
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Action Buttons */}
                <div className="rounded-2xl bg-card border border-border/50 p-6 shadow-sm space-y-3">
                  <Button
                    onClick={() => setSnoozeDialogOpen(true)}
                    variant="outline"
                    className="w-full h-14 rounded-xl text-base font-semibold"
                  >
                    <Clock className="h-5 w-5 mr-3" />
                    Snooze
                  </Button>
                  <Button
                    onClick={handleAssignToMe}
                    variant="outline"
                    className="w-full h-14 rounded-xl text-base font-semibold"
                  >
                    <UserPlus className="h-5 w-5 mr-3" />
                    Assign to Me
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Snooze Dialog */}
      {selectedConversation && (
        <SnoozeDialog
          conversationId={selectedConversation.id}
          open={snoozeDialogOpen}
          onOpenChange={setSnoozeDialogOpen}
          onSuccess={handleUpdate}
        />
      )}
    </div>
  );
};
