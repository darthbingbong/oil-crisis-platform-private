import { createContext, useContext } from "react";
import type { PriceState } from "./usePrice";

export const PriceContext = createContext<PriceState>({ kind: "loading" });

/** The one shared answer of the EIA price poller (see PriceProvider). */
export function usePriceState(): PriceState {
  return useContext(PriceContext);
}
