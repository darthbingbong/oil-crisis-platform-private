import { useEffect, useState } from "react";
import { getVesselNear, getVesselTrack } from "../lib/api";
import type { VesselNear, VesselTrack } from "../types";

export interface VesselExtras {
  mmsi: number | null;
  track: VesselTrack | null;
  near: VesselNear | null;
  loading: boolean;
}

const EMPTY: VesselExtras = { mmsi: null, track: null, near: null, loading: false };

/** The saved past track and the saved Nearby sample for the selected real vessel. Both come from disk on the server (no provider call), fetched once per selection;
 *  a failure just means "no saved track" / no sample, never an error on screen. */
export function useVesselExtras(mmsi: number | null): VesselExtras {
  const [state, setState] = useState<VesselExtras>(EMPTY);
  useEffect(() => {
    if (mmsi === null) return;
    let cancelled = false;
    Promise.all([getVesselTrack(mmsi).catch(() => null), getVesselNear(mmsi).catch(() => null)]).then(([track, near]) => {
      if (!cancelled) setState({ mmsi, track, near, loading: false });
    });
    return () => { cancelled = true; };
  }, [mmsi]);
  if (mmsi === null) return EMPTY;
  return state.mmsi === mmsi ? state : { mmsi, track: null, near: null, loading: true };
}
