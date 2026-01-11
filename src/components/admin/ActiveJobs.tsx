import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, RefreshCw, Clock, Mail, Tag } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Job {
  id: string;
  type: 'email_import' | 'classification';
  status: string;
  workspace_id: string;
  progress: number;
  total: number;
  created_at: string;
  updated_at: string;
  error_message?: string;
}

export function ActiveJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const [emailJobs, classificationJobs] = await Promise.all([
        supabase
          .from('email_import_jobs')
          .select('id, status, workspace_id, headers_fetched, bodies_fetched, created_at, updated_at, error_message')
          .in('status', ['in_progress', 'paused', 'pending'])
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('classification_jobs')
          .select('id, status, workspace_id, classified_count, total_to_classify, created_at, updated_at, error_message')
          .in('status', ['in_progress', 'paused', 'pending'])
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      const formattedJobs: Job[] = [
        ...(emailJobs.data || []).map(job => ({
          id: job.id,
          type: 'email_import' as const,
          status: job.status,
          workspace_id: job.workspace_id,
          progress: job.bodies_fetched || 0,
          total: job.headers_fetched || 0,
          created_at: job.created_at,
          updated_at: job.updated_at,
          error_message: job.error_message ?? undefined,
        })),
        ...(classificationJobs.data || []).map(job => ({
          id: job.id,
          type: 'classification' as const,
          status: job.status,
          workspace_id: job.workspace_id,
          progress: job.classified_count || 0,
          total: job.total_to_classify || 0,
          created_at: job.created_at,
          updated_at: job.updated_at,
          error_message: job.error_message ?? undefined,
        })),
      ];

      setJobs(formattedJobs);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'in_progress':
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">Running</Badge>;
      case 'paused':
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Paused</Badge>;
      case 'pending':
        return <Badge className="bg-gray-500/10 text-gray-500 border-gray-500/20">Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getJobIcon = (type: Job['type']) => {
    switch (type) {
      case 'email_import':
        return <Mail className="h-4 w-4 text-blue-500" />;
      case 'classification':
        return <Tag className="h-4 w-4 text-purple-500" />;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Active Jobs</CardTitle>
        <Button variant="ghost" size="sm" onClick={fetchJobs} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No active jobs</p>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => {
              const progressPercent = job.total > 0 ? (job.progress / job.total) * 100 : 0;
              
              return (
                <div key={job.id} className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getJobIcon(job.type)}
                      <span className="font-medium capitalize">{job.type.replace('_', ' ')}</span>
                      {getStatusBadge(job.status)}
                    </div>
                    <div className="flex gap-2">
                      {job.status === 'paused' && (
                        <Button size="sm" variant="outline">
                          <Play className="h-3 w-3" />
                        </Button>
                      )}
                      {job.status === 'in_progress' && (
                        <Button size="sm" variant="outline">
                          <Pause className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>{job.progress} / {job.total}</span>
                      <span>{progressPercent.toFixed(1)}%</span>
                    </div>
                    <Progress value={progressPercent} className="h-2" />
                    
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span className="font-mono truncate max-w-[200px]">{job.workspace_id}</span>
                      <span>Updated {formatDistanceToNow(new Date(job.updated_at))} ago</span>
                    </div>
                    
                    {job.error_message && (
                      <p className="text-xs text-red-500 mt-2">{job.error_message}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
