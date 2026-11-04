import { useState } from "react";

/**
 * The "SNAPSHOT <time> · 12 REAL TANKERS" badge on the map and the globe. The title and the AIS key line are always shown (an expired key must never be hidden);
 * the longer sample note ("a sample of real tankers near ..., not chokepoint traffic and not coverage of any area") is open on a laptop and tablet and folded
 * behind the title on a phone, where the full text covered half of the map. One tap opens it.
 */
export default function SnapshotBadge({ testId, title, label, keyLine, expired, className, style }: {
  testId: string; title: string; label: string; keyLine: string; expired: boolean; className?: string; style: React.CSSProperties;
}) {
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 640);
  return (
    <div data-testid={testId} className={`data-readout ${className ?? ""}`} style={style}>
      <button type="button" data-testid="badge-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        style={{ pointerEvents: "auto", cursor: "pointer", color: "inherit", font: "inherit", textAlign: "right", background: "none", border: "none", padding: 0, minHeight: 28 }}>
        {title} <span aria-hidden className="sm:hidden">{open ? "▴" : "▾"}</span>
      </button>
      {open && <span style={{ display: "block", color: "var(--color-ash)" }}>{label}</span>}
      <span data-testid="ais-key-line" style={{ display: "block", color: expired ? "var(--color-alarm)" : "var(--color-ash)" }}>{keyLine}</span>
    </div>
  );
}
