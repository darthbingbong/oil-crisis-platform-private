import { useEffect, useState } from "react";

/** Vessel search is capped on the server (20 provider calls a minute, one a second: backend/services/shipfinder.py), but the box must not even try to
 *  flood it: nothing is sent while the user is still typing, and nothing is sent for one or two characters. */
export const SEARCH_DEBOUNCE_MS = 600;
export const SEARCH_MIN_CHARS = 3;

/** The text to send to the search endpoint: null until the user has paused for SEARCH_DEBOUNCE_MS with at least SEARCH_MIN_CHARS characters. */
export function useDebouncedQuery(text: string): string | null {
  const q = text.trim();
  const [debounced, setDebounced] = useState<string | null>(null);
  // too short to search: forget the last query during render (React's pattern for state that follows a value), not inside an effect
  if (q.length < SEARCH_MIN_CHARS && debounced !== null) setDebounced(null);
  useEffect(() => {
    if (q.length < SEARCH_MIN_CHARS) return;
    const id = window.setTimeout(() => setDebounced(q), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [q]);
  return debounced;
}
