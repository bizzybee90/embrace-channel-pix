import { useState, useEffect, useRef } from 'react';

interface ScrollState {
  direction: 'up' | 'down';
  isAtTop: boolean;
  isHidden: boolean;
}

export const useScrollDirection = (threshold: number = 120) => {
  const [scrollState, setScrollState] = useState<ScrollState>({
    direction: 'up',
    isAtTop: true,
    isHidden: false,
  });
  const lastScrollY = useRef(0);
  const ticking = useRef(false);
  const scrollTimeout = useRef<NodeJS.Timeout>();

  useEffect(() => {
    const updateScrollState = () => {
      const scrollY = window.scrollY;
      const isAtTop = scrollY < 10;
      
      if (Math.abs(scrollY - lastScrollY.current) < 5) {
        ticking.current = false;
        return;
      }

      const direction = scrollY > lastScrollY.current ? 'down' : 'up';
      const isHidden = direction === 'down' && scrollY > threshold && !isAtTop;

      setScrollState({
        direction,
        isAtTop,
        isHidden,
      });

      lastScrollY.current = scrollY;
      ticking.current = false;

      // Clear existing timeout
      if (scrollTimeout.current) {
        clearTimeout(scrollTimeout.current);
      }

      // Show nav after scrolling stops (300ms)
      scrollTimeout.current = setTimeout(() => {
        setScrollState(prev => ({
          ...prev,
          isHidden: false,
        }));
      }, 300);
    };

    const onScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(updateScrollState);
        ticking.current = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scrollTimeout.current) {
        clearTimeout(scrollTimeout.current);
      }
    };
  }, [threshold]);

  return scrollState;
};
