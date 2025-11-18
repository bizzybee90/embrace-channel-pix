import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@/lib/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export const TeamStatus = () => {
  const [teamMembers, setTeamMembers] = useState<User[]>([]);

  useEffect(() => {
    const fetchTeam = async () => {
      const { data } = await supabase
        .from('users')
        .select('*')
        .order('name');

      if (data) {
        setTeamMembers(data as User[]);
      }
    };

    fetchTeam();

    // Real-time subscription for team status updates
    const channel = supabase
      .channel('team-status')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'users'
        },
        () => {
          fetchTeam();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available':
        return 'bg-green-500';
      case 'busy':
        return 'bg-red-500';
      case 'away':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-400';
    }
  };

  return (
    <div>
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Team Status
      </h2>
      <div className="space-y-2">
        {teamMembers.map((member) => (
          <div key={member.id} className="flex items-center gap-2 text-sm">
            <div className="relative">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-xs">
                  {member.name.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div
                className={`absolute bottom-0 right-0 h-2 w-2 rounded-full border border-background ${getStatusColor(member.status)}`}
              />
            </div>
            <span className="flex-1 truncate">{member.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
