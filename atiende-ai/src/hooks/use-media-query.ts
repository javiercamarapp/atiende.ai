import { useSyncExternalStore } from 'react';

// Matches a CSS media query reactively without the
// "setState synchronously inside useEffect" footgun. Uses
// useSyncExternalStore so subscribe/snapshot are cleanly separated and
// hydration is safe (server snapshot returns false).
function subscribe(query: string) {
  return (onStoreChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onStoreChange);
    return () => mql.removeEventListener('change', onStoreChange);
  };
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}
