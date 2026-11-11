import type { HeadlinesState } from "../hooks/useHeadlines";

const TAG_LABEL: Record<string, string> = {
  general: "General", closure: "Closure", attack: "Attack", sanctions: "Sanctions", weather: "Weather", incident: "Incident", congestion: "Congestion",
};

function fmtUtc(iso: string | null | undefined): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "unknown";
}

/** The News Alert Feed on the public site. There is no live alert stream there (the NewsAPI and Claude pipeline is off in hosted mode), so this panel lists the newest
 * GDELT headlines across the routes, from the server's cache, each with its publisher, publication time, rule-based tag and route, and says when the cache was fetched.
 * It never shows "CONNECTING": it is loading, ready, or says plainly that news is not available. */
export default function HeadlinesFeed({ state }: { state: HeadlinesState }) {
  const d = state.phase === "ready" ? state.data : null;
  const badge = state.phase === "loading" ? "LOADING" : state.phase === "error" ? "NEWS UNAVAILABLE" : d!.status === "ok" ? "ROUTE NEWS · GDELT" : d!.status === "warming" ? "WARMING UP" : "NO HEADLINES";
  const badgeColor = state.phase === "ready" && d!.status === "ok" ? "var(--color-crude)" : state.phase === "error" ? "var(--color-alarm)" : "var(--color-ash)";
  return (
    <div className="flex flex-col gap-6" data-testid="headlines-feed">
      <div className="flex items-center justify-between">
        <h2 className="section-label" style={{ color: "var(--color-bone)" }}>News Alert Feed</h2>
        <span data-testid="headlines-badge" className="section-label" style={{ color: badgeColor }}>{badge}</span>
      </div>
      {state.phase === "loading" && <p className="text-sm font-light" style={{ color: "var(--color-ash)" }}>Loading the newest route headlines.</p>}
      {state.phase === "error" && (
        <p data-testid="headlines-error" className="text-sm font-light leading-relaxed" style={{ color: "var(--color-ash)" }}>
          Live news alerts are not available on this public demo. Route news is shown in each route panel.
        </p>
      )}
      {d && (
        <>
          <p className="text-xs font-light leading-relaxed" style={{ color: "var(--color-ash)" }}>
            Live news alerts are not part of this public demo. These are the newest headlines about the shipping routes, from the GDELT Project, tagged by a keyword rule (not a model).
            {d.fetched_newest && <> Headlines fetched {fmtUtc(d.fetched_oldest)}{d.fetched_oldest !== d.fetched_newest && <> to {fmtUtc(d.fetched_newest)}</>}.</>} They do not move any price here.
          </p>
          {d.items.length === 0 ? (
            <p data-testid="headlines-empty" className="text-sm font-light leading-relaxed" style={{ color: "var(--color-ash)" }}>{d.message ?? "No headlines yet."}</p>
          ) : (
            <ul className="flex flex-col gap-5">
              {d.items.map((h) => (
                <li key={h.url} className="flex flex-col gap-1.5" data-testid="headline-item">
                  <div className="flex items-center justify-between gap-3">
                    <span className="data-readout text-[11px]" style={{ color: "var(--color-ash)" }}>{fmtUtc(h.published_at)}</span>
                    <span className="data-readout text-[11px]" style={{ color: "var(--color-ash)" }} title="Tag from a keyword rule">{TAG_LABEL[h.tag] ?? h.tag}</span>
                  </div>
                  <a href={h.url} target="_blank" rel="noopener noreferrer" className="text-sm font-light leading-snug hover:underline" style={{ color: "var(--color-bone)" }}>{h.title}</a>
                  <span className="section-label" style={{ fontSize: 11, color: "var(--color-ash)" }}>{h.source} · {h.route_name}{h.feed_status === "snapshot" ? " · saved copy" : h.feed_status === "stale" ? " · older copy" : ""}</span>
                  <div className="hairline mt-2" />
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] font-light" style={{ color: "var(--color-ash)" }}>{d.attribution}</p>
        </>
      )}
    </div>
  );
}
