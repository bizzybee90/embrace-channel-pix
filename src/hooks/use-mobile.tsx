import * as React from "react";

// Mobile: < 760px (phones only)
const MOBILE_BREAKPOINT = 760;

export function useIsMobile() {
  const getIsMobile = () => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < MOBILE_BREAKPOINT;
  };

  const [isMobile, setIsMobile] = React.useState<boolean>(getIsMobile);

  React.useEffect(() => {
    const onChange = () => {
      setIsMobile(getIsMobile());
    };
    
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
  }, []);

  return isMobile;
}
