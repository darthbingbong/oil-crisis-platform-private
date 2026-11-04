import { PriceContext } from "./priceContext";
import { usePrice } from "./usePrice";

/** ONE poller of the EIA price for the whole page: the ticker, the header baseline and the Markets panel all read the same answer, so the three can never disagree
 * (and the backend is asked once, not three times). */
export function PriceProvider({ children }: { children: React.ReactNode }) {
  const state = usePrice();
  return <PriceContext.Provider value={state}>{children}</PriceContext.Provider>;
}
