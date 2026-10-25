import { useEffect, useState } from "react";
import { getRoutes } from "../lib/api";
import type { RoutesResponse } from "../types";

export type RoutesState =
  | { status: "loading"; data: null }
  | { status: "ready"; data: RoutesResponse }
  | { status: "error"; data: null; message: string };

/** Routes come only from the backend (no mock fallback: route data is sourced, so it is never fabricated).
 * On failure the globe simply has no route layer and the UI says so. */
export function useRoutes(): RoutesState {
  const [state, setState] = useState<RoutesState>({ status: "loading", data: null });
  useEffect(() => {
    let cancelled = false;
    getRoutes()
      .then((data) => !cancelled && setState({ status: "ready", data }))
      .catch((e: Error) => !cancelled && setState({ status: "error", data: null, message: e.message }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
