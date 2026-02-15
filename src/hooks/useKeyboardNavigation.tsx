import { useEffect, useCallback } from 'react';
import { Conversation } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';

interface UseKeyboardNavigationProps {
  conversations: Conversation[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onSelect: (conversation: Conversation) => void;
  onArchive?: (conversation: Conversation) => void;
  enabled?: boolean;
}

export const useKeyboardNavigation = ({
  conversations,
  selectedIndex,
  onSelectIndex,
  onSelect,
  onArchive,
  enabled = true,
}: UseKeyboardNavigationProps) => {
  const handleArchive = useCallback(async (conv: Conversation) => {
    if (onArchive) {
      onArchive(conv);
      return;
    }
    await supabase
      .from('conversations')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', conv.id);
  }, [onArchive]);

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      switch (e.key) {
        case 'j': // Next
          e.preventDefault();
          onSelectIndex(Math.min(selectedIndex + 1, conversations.length - 1));
          break;
        case 'k': // Previous
          e.preventDefault();
          onSelectIndex(Math.max(selectedIndex - 1, 0));
          break;
        case 'Enter': // Open
          e.preventDefault();
          if (conversations[selectedIndex]) {
            onSelect(conversations[selectedIndex]);
          }
          break;
        case 'e': // Archive
          e.preventDefault();
          if (conversations[selectedIndex]) {
            handleArchive(conversations[selectedIndex]);
          }
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, conversations, selectedIndex, onSelectIndex, onSelect, handleArchive]);
};
