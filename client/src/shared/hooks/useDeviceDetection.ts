import { useState, useEffect } from "react";

const MOBILE_EXPERIENCE_KEY = "itmap-mobile-experience";
const MOBILE_BREAKPOINT = 768;

/**
 * Detects if user should see mobile experience based on:
 * 1. User preference (localStorage override)
 * 2. User agent detection
 * 3. Screen width
 */
export function useDeviceDetection() {
  const [isMobileDevice, setIsMobileDevice] = useState<boolean>(() => {
    // Check localStorage preference first
    const storedPreference = localStorage.getItem(MOBILE_EXPERIENCE_KEY);
    if (storedPreference !== null) {
      return storedPreference === "true";
    }

    // Check user agent for mobile devices
    const userAgent = navigator.userAgent.toLowerCase();
    const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
    const isMobileUA = mobileRegex.test(userAgent);

    // Check screen width
    const isSmallScreen = window.innerWidth < MOBILE_BREAKPOINT;

    return isMobileUA || isSmallScreen;
  });

  useEffect(() => {
    // Listen for resize events
    const handleResize = () => {
      const storedPreference = localStorage.getItem(MOBILE_EXPERIENCE_KEY);
      if (storedPreference === null) {
        setIsMobileDevice(window.innerWidth < MOBILE_BREAKPOINT);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const setMobileExperience = (useMobile: boolean) => {
    localStorage.setItem(MOBILE_EXPERIENCE_KEY, String(useMobile));
    setIsMobileDevice(useMobile);
    // Force reload to switch experience
    window.location.reload();
  };

  const clearMobilePreference = () => {
    localStorage.removeItem(MOBILE_EXPERIENCE_KEY);
    // Redetect based on device
    const userAgent = navigator.userAgent.toLowerCase();
    const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
    const isMobileUA = mobileRegex.test(userAgent);
    const isSmallScreen = window.innerWidth < MOBILE_BREAKPOINT;
    setIsMobileDevice(isMobileUA || isSmallScreen);
    window.location.reload();
  };

  return {
    isMobileDevice,
    setMobileExperience,
    clearMobilePreference,
  };
}

/**
 * Simple hook for responsive styling (not for routing)
 * Use useDeviceDetection for mobile/desktop routing decisions
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
