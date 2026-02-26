import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Users, MessageSquare, Mail, HelpCircle, Building2, FileText, Mic } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface StatItem {
  name: string;
  value: number | null;
  icon: React.ReactNode;
  color: string;
}

export function DataStats() {
  const [stats, setStats] = useState<StatItem[]>([
    { name: 'Workspaces', value: null, icon: <Building2 className="h-4 w-4" />, color: 'text-blue-500' },
    { name: 'Customers', value: null, icon: <Users className="h-4 w-4" />, color: 'text-green-500' },
    { name: 'Conversations', value: null, icon: <MessageSquare className="h-4 w-4" />, color: 'text-amber-500' },
    { name: 'Messages', value: null, icon: <Mail className="h-4 w-4" />, color: 'text-orange-500' },
    { name: 'FAQs', value: null, icon: <HelpCircle className="h-4 w-4" />, color: 'text-cyan-500' },
    { name: 'Raw Emails', value: null, icon: <FileText className="h-4 w-4" />, color: 'text-pink-500' },
    { name: 'Voice Profiles', value: null, icon: <Mic className="h-4 w-4" />, color: 'text-yellow-500' },
  ]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    
    try {
      const [
        workspacesRes,
        customersRes,
        conversationsRes,
        messagesRes,
        faqsRes,
        rawEmailsRes,
        voiceProfilesRes,
      ] = await Promise.all([
        supabase.from('workspaces').select('id', { count: 'exact', head: true }),
        supabase.from('customers').select('id', { count: 'exact', head: true }),
        supabase.from('conversations').select('id', { count: 'exact', head: true }),
        supabase.from('messages').select('id', { count: 'exact', head: true }),
        supabase.from('faq_database').select('id', { count: 'exact', head: true }),
        supabase.from('raw_emails').select('id', { count: 'exact', head: true }),
        supabase.from('voice_profiles').select('id', { count: 'exact', head: true }),
      ]);

      setStats([
        { name: 'Workspaces', value: workspacesRes.count ?? 0, icon: <Building2 className="h-4 w-4" />, color: 'text-blue-500' },
        { name: 'Customers', value: customersRes.count ?? 0, icon: <Users className="h-4 w-4" />, color: 'text-green-500' },
        { name: 'Conversations', value: conversationsRes.count ?? 0, icon: <MessageSquare className="h-4 w-4" />, color: 'text-amber-500' },
        { name: 'Messages', value: messagesRes.count ?? 0, icon: <Mail className="h-4 w-4" />, color: 'text-orange-500' },
        { name: 'FAQs', value: faqsRes.count ?? 0, icon: <HelpCircle className="h-4 w-4" />, color: 'text-cyan-500' },
        { name: 'Raw Emails', value: rawEmailsRes.count ?? 0, icon: <FileText className="h-4 w-4" />, color: 'text-pink-500' },
        { name: 'Voice Profiles', value: voiceProfilesRes.count ?? 0, icon: <Mic className="h-4 w-4" />, color: 'text-yellow-500' },
      ]);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
      {stats.map((stat) => (
        <Card key={stat.name} className="bg-card/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className={stat.color}>{stat.icon}</span>
              <span className="text-xs text-muted-foreground truncate">{stat.name}</span>
            </div>
            {loading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <p className="text-xl font-bold">{stat.value !== null ? formatNumber(stat.value) : '-'}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
