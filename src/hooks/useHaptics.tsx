/**
 * Haptic feedback hook for touch devices
 * 
 * Provides tactile feedback for user interactions on devices that support
 * the Vibration API. Automatically guards against non-touch devices.
 */

export type HapticPattern = 'light' | 'medium' | 'success' | 'warning';

export const useHaptics = () => {
  const isTouchDevice = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches;
  };

  const trigger = (pattern: HapticPattern) => {
    // Only trigger on touch devices with vibration support
    if (!isTouchDevice() || typeof navigator === 'undefined' || !('vibrate' in navigator)) {
      return;
    }

    switch (pattern) {
      case 'light':
        // Quick tap for selections and button presses
        navigator.vibrate(10);
        break;
      case 'medium':
        // Moderate feedback for drawer opens and tab changes
        navigator.vibrate(20);
        break;
      case 'success':
        // Double pulse for successful actions
        navigator.vibrate([15, 10, 10]);
        break;
      case 'warning':
        // Longer pulse for errors or warnings
        navigator.vibrate(30);
        break;
    }
  };

  return { trigger };
};
