import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHaptics } from '@/hooks/useHaptics';

interface BackToListFABProps {
  visible: boolean;
  onClick: () => void;
}

/**
 * Floating Action Button for returning to ticket list
 * 
 * Appears in bottom-left corner when user scrolls down in conversation view.
 * Provides quick navigation back to ticket list without scrolling to top.
 * 
 * Design: Translucent circular button with backdrop blur
 */
export const BackToListFAB = ({ visible, onClick }: BackToListFABProps) => {
  const { trigger } = useHaptics();

  const handleClick = () => {
    trigger('light');
    // Smooth scroll to top first
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Then navigate back
    setTimeout(onClick, 300);
  };

  return (
    <Button
      onClick={handleClick}
      size="icon"
      className={`
        fixed bottom-8 left-8 z-50
        h-14 w-14 rounded-full
        bg-card/80 backdrop-blur-md
        border border-border/50
        shadow-xl
        transition-all duration-200
        hover:scale-105 hover:shadow-2xl
        ${visible 
          ? 'opacity-100 translate-y-0 pointer-events-auto' 
          : 'opacity-0 translate-y-2 pointer-events-none'
        }
      `}
      aria-label="Back to ticket list"
    >
      <ChevronLeft className="h-5 w-5" />
    </Button>
  );
};
