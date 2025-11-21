import { useEffect } from 'react';
import { BREAKPOINTS } from '@/lib/constants/breakpoints';

/**
 * Development-only layout validator for tablet mode
 * 
 * Checks if sidebar + main content width exceeds viewport and warns in console.
 * Only runs in development mode and tablet breakpoint range.
 * 
 * Usage: Add to TabletLayout.tsx and tag DOM elements with:
 * - data-sidebar
 * - data-main-content
 */
export const useTabletLayoutValidator = () => {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

    const width = window.innerWidth;
    const isTablet =
      width >= BREAKPOINTS.TABLET_MIN && width <= BREAKPOINTS.TABLET_MAX;

    if (!isTablet) return;

    const sidebar = document.querySelector<HTMLElement>('[data-sidebar]');
    const mainContent = document.querySelector<HTMLElement>('[data-main-content]');

    if (!sidebar || !mainContent) {
      console.warn('⚠️ Tablet layout validator: Missing data attributes on sidebar or main content');
      return;
    }

    const totalWidth = sidebar.offsetWidth + mainContent.offsetWidth;
    const tolerance = 50; // Allow 50px tolerance for borders/padding

    if (totalWidth > width + tolerance) {
      console.warn('⚠️ Tablet layout overflow detected!', {
        viewport: width,
        sidebar: sidebar.offsetWidth,
        content: mainContent.offsetWidth,
        total: totalWidth,
        overflow: totalWidth - width,
      });
    }
  }, []);
};
