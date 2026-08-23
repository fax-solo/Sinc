/**
 * Reduced-motion support (M7.2). Respects the OS "reduce motion" setting so
 * looping/decorative animations are suppressed for vestibular-sensitive
 * users. Components that animate should call this and skip loops when true.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduce(enabled);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduce(enabled);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduce;
}
