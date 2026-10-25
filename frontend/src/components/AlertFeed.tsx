import type { AlertEvent, ClassifierUsed } from "../types";
import type { StreamStatus } from "../hooks/useNewsStream";

interface Props {
  alerts: AlertEvent[];
  status: StreamStatus;
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  chokepoint_disruption: "Chokepoint",
  opec_decision: "OPEC",
  sanctions: "Sanctions",
  conflict_escalation: "Conflict",
  supply_outage: "Supply outage",
  ev_lithium_supply: "EV / lithium",
  demand_shock: "Demand",
  other: "Other",
};

// Same threshold-override pattern already used elsewhere in this dashboard
// (ScenarioPanel's priceColor flips to alarm at |pct|>=40, the EV ratio bar
// flips to alarm when ratio>1) -- alarm is reserved for a genuinely large,
// bearish-for-stability move, not just "any negative number."
const CRUDE_ALARM_THRESHOLD_PCT = 1.2;
const LITHIUM_ALARM_THRESHOLD = -0.03;

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function deltaFor(alert: AlertEvent): { text: string; color: string } | null {
  if (alert.price_pct_change !== null) {
    const pct = alert.price_pct_change;
    const color = pct >= CRUDE_ALARM_THRESHOLD_PCT ? "var(--color-alarm)" : "var(--color-crude)";
    return { text: `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`, color };
  }
  if (alert.lithium_index_after !== null && alert.lithium_index_before !== null) {
    const delta = alert.lithium_index_after - alert.lithium_index_before;
    const color = delta <= LITHIUM_ALARM_THRESHOLD ? "var(--color-alarm)" : "var(--color-ion)";
    return { text: `${delta > 0 ? "+" : ""}${delta.toFixed(3)} idx`, color };
  }
  return null;
}

export default function AlertFeed({ alerts, status }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="section-label" style={{ color: "var(--color-bone)" }}>
          News Alert Feed
        </h2>
        <StreamStatusBadge status={status} />
      </div>

      {alerts.length === 0 ? (
        <p className="text-sm font-light leading-relaxed" style={{ color: "var(--color-ash)" }}>
          No classified news events yet. Simulated price/feasibility updates will appear here the
          moment a relevant article is classified.
        </p>
      ) : (
        <ul className="flex flex-col gap-5">
          {alerts.map((a) => {
            const delta = deltaFor(a);
            return (
              <li key={a.id} className="alert-enter flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="data-readout text-[11px]" style={{ color: "var(--color-ash)" }}>
                    {timeAgo(a.occurred_at)}
                  </span>
                  <div className="flex items-center gap-2">
                    <ClassifierTag classifier={a.classifier_used} />
                    {delta && (
                      <span className="data-readout text-xs" style={{ color: delta.color }}>
                        {delta.text}
                      </span>
                    )}
                  </div>
                </div>
                <a
                  href={a.article_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-light leading-snug hover:underline"
                  style={{ color: "var(--color-bone)" }}
                >
                  {a.summary}
                </a>
                <span className="section-label" style={{ fontSize: 10, color: "var(--color-ash)" }}>
                  {EVENT_TYPE_LABEL[a.event_type] ?? a.event_type}
                </span>
                <div className="hairline mt-2" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ClassifierTag({ classifier }: { classifier: ClassifierUsed }) {
  const isClaude = classifier === "claude";
  return (
    <span
      className="data-readout"
      style={{
        fontSize: 9,
        letterSpacing: "0.04em",
        color: isClaude ? "var(--color-bone)" : "var(--color-ash)",
        opacity: isClaude ? 1 : 0.7,
      }}
      title={isClaude ? "Classified by Claude" : "Classified by the rule-based fallback (no Anthropic key configured)"}
    >
      {isClaude ? "CLAUDE" : "RULES"}
    </span>
  );
}

function StreamStatusBadge({ status }: { status: StreamStatus }) {
  const color =
    status === "open" ? "var(--color-crude)" : status === "reconnecting" ? "var(--color-alarm)" : "var(--color-ash)";
  const text = status === "open" ? "NEWS STREAM CONNECTED" : status === "reconnecting" ? "RECONNECTING" : "CONNECTING";
  return (
    <span className="section-label flex items-center gap-1.5" style={{ color }}>
      <span
        className="w-1 h-1 rounded-full"
        style={{ background: color, boxShadow: status === "open" ? `0 0 6px ${color}` : "none" }}
      />
      {text}
    </span>
  );
}
