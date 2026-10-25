import { useEffect, useRef, useState } from "react";
import { getPriceHistory, getPriceLive } from "../lib/api";
import type { PriceHistory, PriceLive } from "../types";

export type PriceState =
  | { kind: "loading" }
  | { kind: "ready"; live: PriceLive; history: PriceHistory | null; updatedAt: number }
  | { kind: "error"; message: string; retryInSeconds: number; last: { live: PriceLive; history: PriceHistory | null } | null };

/** EIA spot prices are daily closes in a weekly release, so there is nothing to gain from polling fast: every 10 minutes is plenty
 * (the server also caches for 15). After an error the wait doubles from 30 s up to 10 min, and the page refetches when a hidden tab
 * becomes visible again if the last success is more than 5 minutes old. */
export const POLL_MS = 10 * 60 * 1000;
export const BACKOFF_START_MS = 30 * 1000;
export const BACKOFF_MAX_MS = 10 * 60 * 1000;

export function nextBackoff(previousMs: number): number {
  return Math.min(previousMs * 2, BACKOFF_MAX_MS);
}

export function usePrice(): PriceState {
  const [state, setState] = useState<PriceState>({ kind: "loading" });
  const lastGood = useRef<{ live: PriceLive; history: PriceHistory | null } | null>(null);
  const lastOk = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let backoff = BACKOFF_START_MS;

    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, ms);
    };

    async function load() {
      try {
        const live = await getPriceLive();
        // The sparkline is a nice-to-have: a failure there must not hide the prices.
        const history = await getPriceHistory(30).catch(() => lastGood.current?.history ?? null);
        if (cancelled) return;
        lastGood.current = { live, history };
        lastOk.current = Date.now();
        backoff = BACKOFF_START_MS;
        setState({ kind: "ready", live, history, updatedAt: lastOk.current });
        schedule(POLL_MS);
      } catch (e) {
        if (cancelled) return;
        setState({ kind: "error", message: e instanceof Error ? e.message : String(e), retryInSeconds: Math.round(backoff / 1000), last: lastGood.current });
        schedule(backoff);
        backoff = nextBackoff(backoff);
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastOk.current > 5 * 60 * 1000) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return state;
}
