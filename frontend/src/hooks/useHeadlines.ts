import { useEffect, useState } from "react";
import { getHeadlines } from "../lib/api";
import type { HeadlinesResponse } from "../types";

export type HeadlinesState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; data: HeadlinesResponse };

const REQUEST_TIMEOUT_MS = 20_000;
const RETRY_WHILE_WARMING_MS = 30_000;

/** The public site's news feed: cached GDELT headlines (GET /api/v1/news/headlines). One request at load; while the server is still on its first refresh (status
 * "warming") it asks again every 30 s. A request that does not answer in 20 s becomes the "error" phase, so the panel never sits on a loading state. */
export function useHeadlines(enabled: boolean): HeadlinesState {
  const [state, setState] = useState<HeadlinesState>({ phase: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      const guard = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), REQUEST_TIMEOUT_MS));
      Promise.race([getHeadlines(), guard])
        .then((data) => {
          if (cancelled) return;
          setState({ phase: "ready", data });
          if (data.status === "warming") timer = setTimeout(load, RETRY_WHILE_WARMING_MS);
        })
        .catch(() => { if (!cancelled) setState((s) => (s.phase === "ready" ? s : { phase: "error" })); });
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [enabled]);
  return state;
}
