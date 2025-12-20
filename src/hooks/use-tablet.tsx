import * as React from "react";

const TABLET_MIN_BREAKPOINT = 760;
const TABLET_MAX_BREAKPOINT = 1200;

export function useIsTablet() {
  // Initialize with actual value to prevent flicker
  const getIsTablet = () => {
    if (typeof window === 'undefined') return false;
    const width = window.innerWidth;
    return width >= TABLET_MIN_BREAKPOINT && width < TABLET_MAX_BREAKPOINT;
  };

  const [isTablet, setIsTablet] = React.useState<boolean>(getIsTablet);

  React.useEffect(() => {
    const onChange = () => {
      setIsTablet(getIsTablet());
    };
    
    window.addEventListener("resize", onChange);
    
    return () => window.removeEventListener("resize", onChange);
  }, []);

  return isTablet;
}
