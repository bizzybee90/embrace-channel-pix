import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppRole } from '@/lib/types';

export const useUserRole = () => {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      setRole(data?.role || null);
      setLoading(false);
    };

    fetchRole();
  }, []);

  return { role, loading, isAdmin: role === 'admin', isManager: role === 'manager' || role === 'admin', isReviewer: !!role };
};
