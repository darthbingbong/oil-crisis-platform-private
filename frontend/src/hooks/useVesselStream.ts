import { useEffect, useRef, useState } from "react";
import { API_ORIGIN } from "../lib/api";
import type { AisVessel } from "../lib/vesselSim";

export interface AisStatus {
  state: "idle" | "no_key" | "connecting" | "streaming" | "error";
  detail: string;
  verified_against_live_feed: boolean;
  disclaimer: string;
  vessel_count: number;
}

/** Is the live AISStream adapter configured on the server? One REST read of /api/v1/vessels/status. null while unknown. It says nothing about the ShipFinder snapshot
 * layer (the saved real tankers), which has its own key and its own endpoint. */
export function useAisStreamConfigured(): boolean | null {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_ORIGIN}/api/v1/vessels/status`).then((r) => r.json()).then((s: { state?: string }) => { if (!cancelled) setConfigured(s.state !== "no_key"); }).catch(() => { if (!cancelled) setConfigured(null); });
    return () => { cancelled = true; };
  }, []);
  return configured;
}

export type StreamPhase = "off" | "connecting" | "open" | "closed";

const PUSH_EVERY_MS = 1000;                 // vessel list handed to the renderer at most once a second
const BACKOFF_START_MS = 5000, BACKOFF_MAX_MS = 60000;

/** Connects to the backend's WS /ws/vessels while `enabled`. The browser only ever talks to OUR backend (the AIS key lives there).
 * If the backend reports no key, it closes the socket after its status frame and we do not retry; any other close is retried with backoff. */
export function useVesselStream(enabled: boolean) {
  const [phase, setPhase] = useState<StreamPhase>("off");
  const [status, setStatus] = useState<AisStatus | null>(null);
  const [vessels, setVessels] = useState<AisVessel[]>([]);
  const map = useRef(new Map<string, AisVessel>());

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | null = null, push: ReturnType<typeof setInterval> | null = null;
    let stopped = false, backoff = BACKOFF_START_MS, noKey = false;
    map.current = new Map();

    const connect = () => {
      if (stopped) return;
      setPhase("connecting");
      ws = new WebSocket(API_ORIGIN ? `${API_ORIGIN.replace(/^http/, "ws")}/ws/vessels` : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/vessels`);
      ws.onopen = () => { backoff = BACKOFF_START_MS; setPhase("open"); };
      ws.onmessage = (ev) => {
        try {
          const f = JSON.parse(ev.data as string);
          if (f.type === "status") { setStatus(f as AisStatus); noKey = f.state === "no_key"; }
          else if (f.type === "snapshot") { map.current = new Map((f.vessels as AisVessel[]).map((v) => [v.mmsi, v])); }
          else if (f.type === "vessel") { map.current.set(f.mmsi, f as AisVessel); }
        } catch { /* ignore a malformed frame */ }
      };
      ws.onclose = () => {
        setPhase("closed");
        if (stopped || noKey) return;
        retry = setTimeout(connect, backoff);
        backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    push = setInterval(() => setVessels(Array.from(map.current.values())), PUSH_EVERY_MS);
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (push) clearInterval(push);
      ws?.close();
      setPhase("off");
    };
  }, [enabled]);

  return { phase, status, vessels };
}
