import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from './useWorkspace';
import { isOutbound, isInbound, type InboxFolder, CATEGORY_GROUPS } from '@/lib/emailDirection';

const PAGE_SIZE = 50;

export interface InboxEmail {
  id: string;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[] | null;
  subject: string | null;
  body: string | null;
  body_html: string | null;
  received_at: string | null;
  category: string | null;
  confidence: number | null;
  needs_review: boolean | null;
  is_noise: boolean | null;
  requires_reply: boolean | null;
  thread_id: string;
  status: string | null;
  direction: string;
}

interface UseInboxEmailsOptions {
  folder: InboxFolder;
  categoryFilter: string | null;
  search: string;
  page: number;
}

export const useInboxEmails = ({ folder, categoryFilter, search, page }: UseInboxEmailsOptions) => {
  const { workspace } = useWorkspace();

  return useQuery({
    queryKey: ['inbox-emails', workspace?.id, folder, categoryFilter, search, page],
    queryFn: async () => {
      if (!workspace?.id) return { emails: [], total: 0 };

      let query = supabase
        .from('email_import_queue')
        .select('id, from_email, from_name, to_emails, subject, body, received_at, category, confidence, needs_review, is_noise, requires_reply, thread_id, status, direction', { count: 'exact' })
        .eq('workspace_id', workspace.id)
        .order('received_at', { ascending: false });

      // Apply folder filters
      switch (folder) {
        case 'inbox':
          query = query
            .not('from_email', 'ilike', '%maccleaning%')
            .or('is_noise.is.null,is_noise.eq.false');
          break;
        case 'sent':
          query = query.ilike('from_email', '%maccleaning%');
          break;
        case 'needs-reply':
          query = query
            .eq('requires_reply', true)
            .not('from_email', 'ilike', '%maccleaning%');
          break;
        case 'ai-review':
          query = query.eq('needs_review', true);
          break;
        case 'noise':
          query = query.or('is_noise.eq.true,category.eq.spam');
          break;
        case 'all':
          // No filter
          break;
      }

      // Apply category filter
      if (categoryFilter) {
        const group = CATEGORY_GROUPS.find(g => g.key === categoryFilter);
        if (group) {
          query = query.in('category', group.categories);
        }
      }

      // Apply search
      if (search.trim()) {
        query = query.or(`from_email.ilike.%${search}%,from_name.ilike.%${search}%,subject.ilike.%${search}%`);
      }

      // Pagination
      query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (error) throw error;

      return { emails: (data || []) as InboxEmail[], total: count || 0 };
    },
    enabled: !!workspace?.id,
    staleTime: 30000,
  });
};

// Fetch full email with body_html for reading pane
export const useEmailDetail = (emailId: string | null) => {
  const { workspace } = useWorkspace();

  return useQuery({
    queryKey: ['inbox-email-detail', emailId],
    queryFn: async () => {
      if (!emailId || !workspace?.id) return null;

      const { data, error } = await supabase
        .from('email_import_queue')
        .select('*')
        .eq('id', emailId)
        .single();

      if (error) throw error;
      return data as InboxEmail;
    },
    enabled: !!emailId && !!workspace?.id,
  });
};

// Fetch thread emails
export const useEmailThread = (threadId: string | null) => {
  const { workspace } = useWorkspace();

  return useQuery({
    queryKey: ['inbox-thread', threadId],
    queryFn: async () => {
      if (!threadId || !workspace?.id) return [];

      const { data, error } = await supabase
        .from('email_import_queue')
        .select('id, from_email, from_name, to_emails, subject, body, body_html, received_at, category, confidence, direction')
        .eq('workspace_id', workspace.id)
        .eq('thread_id', threadId)
        .order('received_at', { ascending: true });

      if (error) throw error;
      return (data || []) as InboxEmail[];
    },
    enabled: !!threadId && !!workspace?.id,
  });
};

// Folder counts - scoped to last 30 days for accuracy
export const useInboxCounts = () => {
  const { workspace } = useWorkspace();

  return useQuery({
    queryKey: ['inbox-counts', workspace?.id],
    queryFn: async () => {
      if (!workspace?.id) return { inbox: 0, needsReply: 0, aiReview: 0, unread: 0 };

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [inboxResult, needsReplyResult, aiReviewResult, unreadResult] = await Promise.all([
        supabase
          .from('email_import_queue')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .not('from_email', 'ilike', '%maccleaning%')
          .or('is_noise.is.null,is_noise.eq.false')
          .gte('received_at', thirtyDaysAgo),
        supabase
          .from('email_import_queue')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .eq('requires_reply', true)
          .not('from_email', 'ilike', '%maccleaning%')
          .gte('received_at', thirtyDaysAgo),
        supabase
          .from('email_import_queue')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .eq('needs_review', true),
        supabase
          .from('email_import_queue')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id)
          .not('from_email', 'ilike', '%maccleaning%')
          .or('is_noise.is.null,is_noise.eq.false')
          .neq('status', 'processed')
          .gte('received_at', thirtyDaysAgo),
      ]);

      return {
        inbox: inboxResult.count || 0,
        needsReply: needsReplyResult.count || 0,
        aiReview: aiReviewResult.count || 0,
        unread: unreadResult.count || 0,
      };
    },
    enabled: !!workspace?.id,
    staleTime: 30000,
    refetchInterval: 60000,
  });
};

// Fetch HTML body on demand via edge function
export const useFetchEmailBody = () => {
  const fetchBody = async (emailId: string): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke('fetch-email-body', {
      body: { email_id: emailId },
    });
    if (error) throw error;
    return data?.body_html || null;
  };
  return { fetchBody };
};
