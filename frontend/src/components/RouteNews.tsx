import { useEffect, useState } from "react";
import { getRouteNews } from "../lib/api";
import { TOKENS } from "../lib/constants";
import type { NewsTag, RouteNews as RouteNewsData } from "../types";

const TAG_COLOR: Record<NewsTag, string> = {
  attack: TOKENS.alarm,
  sanctions: TOKENS.crude,
  disruption: "#e6c84f",
  shipping: "#5aa9ff",
  general: TOKENS.ash,
};

function fmtUtc(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** GDELT's terms require citing the project and linking to its site, so the URL in the attribution is a real link. */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s)]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-ash)", textDecoration: "underline" }}>
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; news: RouteNewsData };

/** "Recent news" section of the route panel. Headline, source, date and link only. Shows the feed's honest state:
 * fresh, STALE (feed down, last cached result with its time), empty (feed fine, nothing matched) or unavailable. */
export default function RouteNews({ routeId }: { routeId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const load = () =>
      getRouteNews(routeId)
        .then((news) => {
          if (cancelled) return;
          setState({ kind: "ready", news });
          // The backend answered instantly with the last cached result while it fetches a new one: check again shortly.
          if (news.refreshing && polls++ < 5) timer = setTimeout(load, 20000);
        })
        .catch((e: Error) => !cancelled && setState({ kind: "error", message: e.message }));
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [routeId]);

  return (
    <div data-testid="route-news">
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <div className="section-label">Recent news</div>
        {state.kind === "ready" && state.news.last_updated && (
          <div className="flex items-center gap-2">
            {state.news.snapshot && (
              <span
                data-testid="news-snapshot-badge"
                className="section-label"
                style={{ padding: "1px 6px", border: "1px solid var(--color-crude)", color: "var(--color-crude)", borderRadius: 3 }}
              >
                demo snapshot
              </span>
            )}
            {state.news.stale && (
              <span
                data-testid="news-stale-badge"
                className="section-label"
                style={{ padding: "1px 6px", border: "1px solid var(--color-alarm)", color: "var(--color-alarm)", borderRadius: 3 }}
              >
                stale
              </span>
            )}
            <span data-testid="news-updated" className="data-readout text-[10px]" style={{ color: "var(--color-ash)" }}>
              {state.news.snapshot ? "fetched" : "updated"} {fmtUtc(state.news.last_updated)}
            </span>
          </div>
        )}
      </div>

      {state.kind === "loading" && (
        <div data-testid="news-loading" aria-label="Loading news" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0.9, 0.7, 0.8].map((w, i) => (
            <div key={i} style={{ height: 12, width: `${w * 100}%`, borderRadius: 3, background: "rgba(244,241,234,0.08)" }} />
          ))}
          <p className="text-[10px]" style={{ color: "var(--color-ash)", margin: 0 }}>
            The free GDELT feed can take 10 to 20 seconds to answer. Results are then cached for 20 minutes.
          </p>
        </div>
      )}

      {state.kind === "error" && (
        <p data-testid="news-message" className="text-xs" style={{ color: "var(--color-alarm)", margin: 0 }}>
          News could not be loaded: {state.message}
        </p>
      )}

      {state.kind === "ready" && (
        <>
          {state.news.message && (
            <p
              data-testid="news-message"
              className="text-xs"
              style={{ color: state.news.stale || state.news.snapshot || state.news.feed_status === "unavailable" ? "var(--color-crude)" : "var(--color-ash)", margin: "0 0 8px" }}
            >
              {state.news.message}
            </p>
          )}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {state.news.items.slice(0, 8).map((item) => (
              <li key={item.url} data-testid="news-item">
                <div className="flex items-start gap-2">
                  <span
                    className="section-label"
                    style={{ flex: "none", marginTop: 1, padding: "0 5px", border: `1px solid ${TAG_COLOR[item.tag]}`, color: TAG_COLOR[item.tag], borderRadius: 3, fontSize: 9 }}
                  >
                    {item.tag}
                  </span>
                  <div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs"
                      style={{ color: "var(--color-bone)", textDecoration: "underline", textDecorationColor: "rgba(244,241,234,0.3)" }}
                    >
                      {item.title}
                    </a>
                    <div className="data-readout text-[10px]" style={{ color: "var(--color-ash)", marginTop: 2 }}>
                      {item.source} · {fmtUtc(item.published_at)}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p data-testid="news-attribution" className="text-[10px]" style={{ color: "var(--color-ash)", margin: "8px 0 0" }}>
            <Linkified text={state.news.attribution} />
          </p>
        </>
      )}
    </div>
  );
}
