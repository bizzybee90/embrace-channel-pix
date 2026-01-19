import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Workspace } from '@/lib/types';

export const useWorkspace = () => {
  const { user, profile } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWorkspace = async () => {
      if (!user || !profile?.workspace_id) {
        setLoading(false);
        return;
      }

      try {
        const wsRef = doc(db, 'workspaces', profile.workspace_id);
        const wsSnap = await getDoc(wsRef);

        if (wsSnap.exists()) {
          setWorkspace({ id: wsSnap.id, ...wsSnap.data() } as Workspace);
        }
      } catch (error) {
        console.error("Error fetching workspace:", error);
      } finally {
        setLoading(false);
      }
    };

    if (profile?.workspace_id) {
      fetchWorkspace();
    } else if (!user) {
      setLoading(false);
    }
  }, [user, profile]);

  return { workspace, loading };
};
