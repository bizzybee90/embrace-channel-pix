import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

export interface EmailImportJob {
  id: string;
  status: string;
  inbox_emails_scanned: number | null;
  sent_emails_scanned: number | null;
  conversation_threads: number | null;
  bodies_fetched: number | null;
  messages_created: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface UseEmailImportStatusResult {
  isImporting: boolean;
  job: EmailImportJob | null;
  progress: number;
  statusMessage: string;
  phase: 'scanning' | 'analyzing' | 'fetching' | 'complete' | 'error' | 'idle';
}

export function useEmailImportStatus(workspaceId: string | null): UseEmailImportStatusResult {
  const { data: job, isLoading } = useQuery({
    queryKey: ['email-import-status', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return null;
      
      const { data, error } = await supabase
        .from('email_import_jobs')
        .select('id, status, inbox_emails_scanned, sent_emails_scanned, conversation_threads, bodies_fetched, messages_created, error_message, started_at, completed_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error('Error fetching import job:', error);
        return null;
      }
      
      return data as EmailImportJob | null;
    },
    enabled: !!workspaceId,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Poll every 3s while importing, stop when done
      if (data && ['scanning', 'analyzing', 'fetching', 'pending'].includes(data.status)) {
        return 3000;
      }
      return false;
    },
    staleTime: 2000,
  });

  const getPhase = (status: string | undefined): UseEmailImportStatusResult['phase'] => {
    if (!status) return 'idle';
    if (status === 'scanning') return 'scanning';
    if (status === 'analyzing') return 'analyzing';
    if (status === 'fetching') return 'fetching';
    if (status === 'completed') return 'complete';
    if (status === 'error' || status === 'failed') return 'error';
    if (status === 'pending') return 'scanning';
    return 'idle';
  };

  const calculateProgress = (job: EmailImportJob | null): number => {
    if (!job) return 0;
    
    const phase = getPhase(job.status);
    const scanned = (job.inbox_emails_scanned || 0) + (job.sent_emails_scanned || 0);
    const threads = job.conversation_threads || 0;
    const fetched = job.bodies_fetched || 0;
    
    switch (phase) {
      case 'scanning':
        // 0-40% for scanning phase
        return Math.min(40, Math.floor(scanned / 50)); // Rough estimate
      case 'analyzing':
        // 40-50% for analyzing
        return 45;
      case 'fetching':
        // 50-95% for fetching bodies
        if (threads > 0) {
          return 50 + Math.floor((fetched / threads) * 45);
        }
        return 50;
      case 'complete':
        return 100;
      case 'error':
        return 0;
      default:
        return 0;
    }
  };

  const getStatusMessage = (job: EmailImportJob | null): string => {
    if (!job) return '';
    
    const phase = getPhase(job.status);
    const scanned = (job.inbox_emails_scanned || 0) + (job.sent_emails_scanned || 0);
    const threads = job.conversation_threads || 0;
    const fetched = job.bodies_fetched || 0;
    const created = job.messages_created || 0;
    
    switch (phase) {
      case 'scanning':
        return `Scanning emails... ${scanned.toLocaleString()} found`;
      case 'analyzing':
        return `Analyzing threads... ${threads} conversations`;
      case 'fetching':
        return `Importing... ${fetched}/${threads} emails`;
      case 'complete':
        return `Import complete! ${created} messages`;
      case 'error':
        return job.error_message || 'Import failed';
      default:
        return '';
    }
  };

  const phase = getPhase(job?.status);
  const isImporting = ['scanning', 'analyzing', 'fetching'].includes(phase);

  return {
    isImporting,
    job,
    progress: calculateProgress(job),
    statusMessage: getStatusMessage(job),
    phase,
  };
}
