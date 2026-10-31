import { useEffect, useState } from 'react';

/** The current time, refreshed every `intervalMs`, so labels like "Already passed" stay true. */
export function useNow(intervalMs = 30_000): [number, () => void] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return [now, () => setNow(Date.now())];
}
