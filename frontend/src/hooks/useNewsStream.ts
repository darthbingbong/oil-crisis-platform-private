import { useEffect, useRef, useState } from "react";
import type { AlertEvent, PriceState } from "../types";
import { API_ORIGIN } from "../lib/api";

export type StreamStatus = "connecting" | "open" | "reconnecting" | "unavailable";

/** Never "CONNECTING" for ever: if the stream has not opened within this time the badge says it is unavailable (it still reconnects quietly). */
const CONNECT_TIMEOUT_MS = 12_000;

interface NewsStreamState {
  status: StreamStatus;
  priceState: PriceState | null;
  alerts: AlertEvent[];
  /** Bumps to the newest alert's id on every live push (not on the initial
   * snapshot) -- consumers (App.tsx) watch this to trigger a historical-
   * chart refetch without re-running on first mount. */
  lastEventId: number | null;
}

const MAX_ALERTS = 30;

interface SnapshotPayload {
  price_state: PriceState;
  recent_alerts: AlertEvent[];
}

interface PriceEventPayload {
  alert: AlertEvent;
  price_state: PriceState;
}

/**
 * Server-Sent Events connection to GET /api/v1/news/stream. Native
 * EventSource (no library) auto-reconnects on a dropped connection with no
 * code required here -- this hook's job is to never clear priceState/alerts
 * while that's happening, so a brief network blip doesn't blank the UI, and
 * to surface a "reconnecting" status so the UI can show it's showing
 * possibly-stale data rather than silently going quiet.
 */
export function useNewsStream(enabled = true): NewsStreamState {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [priceState, setPriceState] = useState<PriceState | null>(null);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [lastEventId, setLastEventId] = useState<number | null>(null);
  const hasConnectedOnce = useRef(false);
  const timedOut = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      timedOut.current = true;
      setStatus((s) => (s === "connecting" ? "unavailable" : s));
    }, CONNECT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // the API origin matters when the page is served from a different host than the API (the public site)
    const source = new EventSource(`${API_ORIGIN}/api/v1/news/stream`);

    source.addEventListener("snapshot", (e) => {
      const payload: SnapshotPayload = JSON.parse((e as MessageEvent).data);
      setPriceState(payload.price_state);
      setAlerts(payload.recent_alerts.slice(0, MAX_ALERTS));
      hasConnectedOnce.current = true;
      setStatus("open");
    });

    source.addEventListener("price_event", (e) => {
      const payload: PriceEventPayload = JSON.parse((e as MessageEvent).data);
      setPriceState(payload.price_state);
      setAlerts((prev) => {
        if (prev.some((a) => a.id === payload.alert.id)) return prev;
        return [payload.alert, ...prev].slice(0, MAX_ALERTS);
      });
      setLastEventId(payload.alert.id);
      setStatus("open");
    });

    source.onopen = () => setStatus("open");
    source.onerror = () => {
      // Deliberately NOT clearing priceState/alerts here -- last-known-good
      // stays on screen. EventSource retries on its own.
      setStatus(hasConnectedOnce.current ? "reconnecting" : timedOut.current ? "unavailable" : "connecting");
    };

    return () => source.close();
  }, [enabled]);

  return { status, priceState, alerts, lastEventId };
}
