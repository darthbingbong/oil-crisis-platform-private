import { useEffect, useState } from "react";
import { getWatchlist } from "../lib/api";
import type { WatchlistResponse } from "../types";

export type WatchlistState =
  | { status: "loading"; data: null }
  | { status: "ready"; data: WatchlistResponse }
  | { status: "error"; data: null };

/** The saved real-tanker snapshot. Any failure (backend down) simply means no real vessels: the map says so and shows only labelled simulated ones. */
export function useWatchlist(): WatchlistState {
  const [state, setState] = useState<WatchlistState>({ status: "loading", data: null });
  useEffect(() => {
    let cancelled = false;
    getWatchlist()
      .then((data) => !cancelled && setState({ status: "ready", data }))
      .catch(() => !cancelled && setState({ status: "error", data: null }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
