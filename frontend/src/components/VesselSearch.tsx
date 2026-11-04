import { useEffect, useState } from "react";
import { searchProvider, searchSaved } from "../lib/api";
import { SEARCH_MIN_CHARS, useDebouncedQuery } from "../hooks/useDebouncedQuery";
import type { ProviderSearch, SavedSearch } from "../types";

interface Props {
  /** open a saved real vessel on whichever view is showing */
  onSelect: (mmsi: number) => void;
}

const PANEL: React.CSSProperties = { position: "absolute", top: "calc(100% + 6px)", left: 0, width: "min(380px, calc(100vw - 32px))", zIndex: 60, background: "rgba(3,3,3,0.97)", border: "1px solid rgba(244,241,234,0.18)", borderRadius: 6, padding: "8px 10px" };

/** Vessel search. Typing searches the SAVED watchlist only (after a pause and at least 3 characters: useDebouncedQuery). The provider's Vessel Search is asked only when the
 *  person presses the button, one call per press; the server applies the per-minute limit, the minimum interval and the circuit breaker, and from the key's expiry date it
 *  makes no call at all. Status 31 is shown as "no match". */
export default function VesselSearch({ onSelect }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebouncedQuery(text);
  const [saved, setSaved] = useState<SavedSearch | null>(null);
  const [provider, setProvider] = useState<ProviderSearch | "loading" | null>(null);
  const q = text.trim();

  useEffect(() => {
    if (debounced === null) return;
    let cancelled = false;
    searchSaved(debounced).then((r) => !cancelled && setSaved(r)).catch(() => !cancelled && setSaved(null));
    return () => { cancelled = true; };
  }, [debounced]);

  const savedShown = debounced !== null && saved?.query === debounced ? saved : null;
  const providerShown = provider && provider !== "loading" && provider.query === q ? provider : null;
  const providerAvailable = savedShown ? savedShown.provider_search.available : true;
  const showPanel = open && q.length > 0;

  const submitProvider = () => {
    if (q.length < SEARCH_MIN_CHARS || provider === "loading") return;
    setProvider("loading");
    searchProvider(q).then(setProvider).catch(() => setProvider({ status: "UNAVAILABLE", query: q, message: "The search could not be sent. Nothing was spent.", results: [], key: { expires_on: "", expires_in_days: 0, expired: false, line: "", saved_on: null } }));
  };
  const pick = (mmsi: number) => { onSelect(mmsi); setOpen(false); setText(""); setProvider(null); };

  return (
    <div style={{ position: "relative", width: "100%" }} data-testid="vessel-search">
      <input
        data-testid="vessel-search-input"
        type="search"
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur(); } }}
        aria-label="Search vessels"
        placeholder="Search vessels: name, MMSI or IMO"
        autoComplete="off"
        className="text-xs"
        style={{ width: "100%", padding: "6px 10px", background: "rgba(3,3,3,0.9)", border: "1px solid rgba(244,241,234,0.25)", borderRadius: 4, color: "var(--color-bone)" }}
      />
      {showPanel && (
        <div data-testid="vessel-search-panel" style={PANEL} onMouseDown={(e) => e.preventDefault()}>
          {q.length < SEARCH_MIN_CHARS && <div className="text-xs" style={{ color: "var(--color-ash)" }}>Type at least {SEARCH_MIN_CHARS} characters.</div>}
          {q.length >= SEARCH_MIN_CHARS && !savedShown && <div className="text-xs" style={{ color: "var(--color-ash)" }}>Searching the saved vessels…</div>}
          {savedShown && (
            <div data-testid="vessel-search-saved">
              <div className="section-label" style={{ color: "var(--color-ash)", marginBottom: 4 }}>SAVED REAL VESSELS</div>
              {savedShown.results.length === 0 && <div data-testid="vessel-search-saved-none" className="text-xs" style={{ color: "var(--color-ash)" }}>{savedShown.message ?? "No saved vessel matches."}</div>}
              {savedShown.results.map((r) => (
                <button key={r.mmsi} type="button" data-testid={`vessel-search-hit-${r.mmsi}`} onClick={() => pick(r.mmsi)} className="text-xs"
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "5px 6px", borderRadius: 3, color: "var(--color-bone)", cursor: "pointer" }}>
                  <span style={{ fontWeight: 600 }}>{r.name ?? `MMSI ${r.mmsi}`}</span> <span style={{ color: "var(--color-ash)" }}>{r.mmsi} · {r.flag ?? "flag not reported"} · {r.area}</span>
                </button>
              ))}
            </div>
          )}
          {q.length >= SEARCH_MIN_CHARS && (
            <div style={{ borderTop: savedShown ? "1px solid rgba(244,241,234,0.12)" : "none", marginTop: 8, paddingTop: 8 }}>
              {providerAvailable ? (
                <>
                  <button type="button" data-testid="vessel-search-provider-button" onClick={submitProvider} disabled={provider === "loading"} className="text-xs"
                    style={{ padding: "5px 9px", border: "1px solid rgba(244,241,234,0.3)", borderRadius: 4, color: "var(--color-bone)", cursor: provider === "loading" ? "wait" : "pointer" }}>
                    {provider === "loading" ? "Searching…" : `Search the provider for “${q}”`}
                  </button>
                  <div className="text-xs" style={{ color: "var(--color-ash)", marginTop: 4 }}>Saved vessels are searched first. The provider is only asked when you press this button (one search per press).</div>
                </>
              ) : (
                <div data-testid="vessel-search-expired" className="text-xs" style={{ color: "var(--color-alarm)" }}>{savedShown?.provider_search.note ?? "AIS key expired: only the saved watchlist can be searched."}</div>
              )}
              {providerShown && (
                <div data-testid="vessel-search-provider-result" style={{ marginTop: 8 }}>
                  {providerShown.message && <div data-testid="vessel-search-message" className="text-xs" style={{ color: providerShown.status === "OK" ? "var(--color-ash)" : "var(--color-caution)" }}>{providerShown.message}</div>}
                  {providerShown.results.map((r) => (
                    <div key={r.mmsi} data-testid={`vessel-search-provider-hit-${r.mmsi}`} className="text-xs" style={{ padding: "4px 6px", color: "var(--color-bone)" }}>
                      <span style={{ fontWeight: 600 }}>{r.name ?? "unnamed"}</span> <span style={{ color: "var(--color-ash)" }}>{r.mmsi}{r.imo ? ` · IMO ${r.imo}` : ""} · {r.flag ?? "flag not reported"}{r.last_report_utc ? ` · last report ${r.last_report_utc.slice(0, 16).replace("T", " ")} UTC` : ""}</span>
                      {r.in_watchlist
                        ? <button type="button" onClick={() => pick(r.mmsi)} style={{ marginLeft: 6, color: "var(--color-ion)", cursor: "pointer" }}>open</button>
                        : <span style={{ marginLeft: 6, color: "var(--color-ash)" }}>no position</span>}
                    </div>
                  ))}
                  {providerShown.note && providerShown.results.length > 0 && <div className="text-xs" style={{ color: "var(--color-ash)", marginTop: 4 }}>{providerShown.note}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
