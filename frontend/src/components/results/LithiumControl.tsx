import { useEffect, useState } from "react";
import { TOKENS } from "../../lib/constants";
import Slider from "../Slider";

interface Props {
  value: number;
  onChange: (v: number) => void;
  chemistryCaveat: string;
}

/** The lithium availability control, with what it means, the USGS anchor for the 10% default, and the NMC-811 / LFP caveat.
 * Moving it re-runs the report (the value lives in the URL). The slider is local while dragging and commits after a short pause. */
export default function LithiumControl({ value, onChange, chemistryCaveat }: Props) {
  // The parent re-keys this component when the committed value changes, so the local (dragging) value starts from it.
  const [local, setLocal] = useState(value);
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChange(local), 350);
    return () => clearTimeout(t);
  }, [local, value, onChange]);

  return (
    <div data-testid="lithium-control" style={{ marginTop: 18, maxWidth: 640 }}>
      <Slider label="Lithium availability" min={0} max={100} step={5} unit="%" value={local} onChange={setLocal} />
      <p className="text-xs font-light leading-relaxed" style={{ color: TOKENS.ash, margin: "0 0 8px" }}>
        How much of today&apos;s world lithium mine output could be redirected to build the EVs that replace the lost oil. It sets the supply cap; the
        shortfall beyond it is the deficit. The 10% default is anchored on USGS (Mineral Commodity Summaries 2026): 2025 production (290,000 t lithium)
        exceeded consumption (263,000 t) by only about 9%, so little output is spare. A scenario input, not a forecast.{" "}
        <a href="https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-lithium.pdf" target="_blank" rel="noopener noreferrer" style={{ color: TOKENS.ash, textDecoration: "underline" }}>USGS ↗</a>
      </p>
      <p data-testid="chemistry-caveat" className="text-xs font-light leading-relaxed" style={{ color: TOKENS.crude, margin: 0 }}>
        Caveat: {chemistryCaveat}
      </p>
    </div>
  );
}
