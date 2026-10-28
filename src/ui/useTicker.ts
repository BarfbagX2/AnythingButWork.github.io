import { useEffect, useState } from 'react';

/** Re-renders the component at a fixed rate (HUD panels read live state). */
export function useTicker(hz: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((x) => (x + 1) % 1e9), 1000 / hz);
    return () => window.clearInterval(id);
  }, [hz]);
  return n;
}
