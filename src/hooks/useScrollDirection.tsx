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
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null);
  const isScrolling = useRef(false);

  useEffect(() => {
    const updateScrollState = () => {
      const scrollY = window.scrollY;
      const isAtTop = scrollY < 10;
      
      if (Math.abs(scrollY - lastScrollY.current) < 5) {
        ticking.current = false;
        return;
      }

      const direction = scrollY > lastScrollY.current ? 'down' : 'up';
      
      // Only hide when scrolling down and past threshold
      const shouldHide = direction === 'down' && scrollY > threshold && !isAtTop;

      setScrollState({
        direction,
        isAtTop,
        isHidden: shouldHide,
      });

      lastScrollY.current = scrollY;
      ticking.current = false;
      isScrolling.current = true;

      // Clear existing timeout
      if (scrollTimeout.current) {
        clearTimeout(scrollTimeout.current);
      }

      // Show nav 200ms after scrolling stops
      scrollTimeout.current = setTimeout(() => {
        isScrolling.current = false;
        setScrollState(prev => ({
          ...prev,
          isHidden: false,
        }));
      }, 200);
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
