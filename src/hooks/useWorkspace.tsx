import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Workspace } from '@/lib/types';

export const useWorkspace = () => {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWorkspace = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userData } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', user.id)
        .single();

      if (userData?.workspace_id) {
        const { data: workspaceData } = await supabase
          .from('workspaces')
          .select('*')
          .eq('id', userData.workspace_id)
          .single();

        setWorkspace(workspaceData);
      }
      setLoading(false);
    };

    fetchWorkspace();
  }, []);

  return { workspace, loading };
};
