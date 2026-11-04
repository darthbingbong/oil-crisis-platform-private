import { useEffect, useState } from "react";
import { getChokepointRisk } from "../lib/api";
import { computeChokepointRisk } from "../lib/chokepointRisk";
import { useAnimatedNumber } from "../lib/useAnimatedNumber";
import { KNOWN_CHOKEPOINTS, type ChokepointRisk, type RefineryHub } from "../types";

interface Props {
  selected: string | null;
  onSelect: (chokepoint: string | null) => void;
  refineries: RefineryHub[];
}

export default function ChokepointPanel({ selected, onSelect, refineries }: Props) {
  const [risk, setRisk] = useState<ChokepointRisk | null>(null);
  const [offline, setOffline] = useState(false);

  // nothing selected: forget the last result during render (React's pattern for state that follows a value), not inside an effect
  if (!selected && risk !== null) setRisk(null);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    getChokepointRisk(selected)
      .then((result) => {
        if (!cancelled) {
          setRisk(result);
          setOffline(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRisk(computeChokepointRisk(refineries, selected));
          setOffline(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected, refineries]);

  const animatedCapacity = useAnimatedNumber(risk?.capacity_at_risk_bpd ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="section-label" style={{ color: "var(--color-bone)" }}>
          Chokepoint Risk
        </h2>
        {risk && offline && (
          <span className="section-label" style={{ color: "var(--color-alarm)" }}>
            OFFLINE
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {KNOWN_CHOKEPOINTS.map((cp) => {
          const isSelected = selected === cp;
          return (
            <button
              key={cp}
              onClick={() => onSelect(isSelected ? null : cp)}
              aria-pressed={isSelected}
              className="min-h-11 flex items-center text-[13px] tracking-wide transition-colors cursor-pointer"
              style={{ color: isSelected ? "var(--color-crude)" : "var(--color-ash)" }}
            >
              {cp}
            </button>
          );
        })}
      </div>

      {risk ? (
        <div>
          <div className="section-label mb-2">Capacity at risk</div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="data-readout text-4xl" style={{ color: "var(--color-alarm)" }}>
              {Math.round(animatedCapacity).toLocaleString()}
            </span>
            <span className="text-sm" style={{ color: "var(--color-ash)" }}>
              bpd
            </span>
          </div>
          <div className="text-sm font-light mb-5" style={{ color: "var(--color-ash)" }}>
            ≈ {(risk.pct_of_global_daily_production * 100).toFixed(1)}% of global daily production
          </div>
          <div className="section-label mb-2">Affected hubs</div>
          <ul className="flex flex-col gap-1">
            {risk.affected_hubs.map((h) => (
              <li key={h} className="text-sm font-light flex items-center gap-2" style={{ color: "var(--color-bone)" }}>
                <span className="w-1 h-1 rounded-full inline-block" style={{ background: "var(--color-alarm)" }} />
                {h}
              </li>
            ))}
            {risk.affected_hubs.length === 0 && (
              <li className="text-sm font-light" style={{ color: "var(--color-ash)" }}>
                No tracked hubs depend on this chokepoint.
              </li>
            )}
          </ul>
        </div>
      ) : (
        <p className="text-sm font-light leading-relaxed" style={{ color: "var(--color-ash)" }}>
          Select a chokepoint to see which refinery/export hubs would be cut off, and how much
          global capacity that represents.
        </p>
      )}
    </div>
  );
}
