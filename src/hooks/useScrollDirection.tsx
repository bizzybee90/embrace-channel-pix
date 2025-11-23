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
    };

    const onScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(updateScrollState);
        ticking.current = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return scrollState;
};
