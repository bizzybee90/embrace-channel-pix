import * as React from "react";

const TABLET_MIN_BREAKPOINT = 768;
const TABLET_MAX_BREAKPOINT = 1200;

export function useIsTablet() {
  const [isTablet, setIsTablet] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const width = window.innerWidth;
    return width >= TABLET_MIN_BREAKPOINT && width < TABLET_MAX_BREAKPOINT;
  });

  React.useEffect(() => {
    const onChange = () => {
      const width = window.innerWidth;
      setIsTablet(width >= TABLET_MIN_BREAKPOINT && width < TABLET_MAX_BREAKPOINT);
    };
    
    window.addEventListener("resize", onChange);
    onChange();
    
    return () => window.removeEventListener("resize", onChange);
  }, []);

  return isTablet;
}
