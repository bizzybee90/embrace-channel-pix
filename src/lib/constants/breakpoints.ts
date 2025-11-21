/**
 * Breakpoint and layout constants for responsive design
 * 
 * CRITICAL: These are the single source of truth for all layout values.
 * Never use magic numbers directly in components - always import from here.
 */

export const BREAKPOINTS = {
  MOBILE_MAX: 759,
  TABLET_MIN: 760,
  TABLET_MAX: 1199,
  DESKTOP_MIN: 1200,
} as const;

export const TABLET_LAYOUT_RULES = {
  /** Sidebar width when collapsed (icons only) */
  SIDEBAR_COLLAPSED_WIDTH: 72,
  
  /** Sidebar width when expanded (icons + labels) */
  SIDEBAR_EXPANDED_WIDTH: 240,
  
  /** Scroll distance before showing floating FAB */
  FAB_SCROLL_THRESHOLD: 200,
  
  /** Drawer width as percentage of viewport (Customer Info / Quick Actions) */
  DRAWER_WIDTH_PERCENT: 0.58,
  
  /** Minimum content width before layout breaks */
  MIN_CONTENT_WIDTH: 400,
} as const;
