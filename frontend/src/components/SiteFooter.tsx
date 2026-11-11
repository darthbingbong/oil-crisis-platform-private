import { useHosted } from "../hooks/useHosted";

export const FALLBACK_DISCLAIMER = "Educational project. Figures are model estimates, not forecasts or financial advice.";
const FALLBACK_REPO = "https://github.com/darthbingbong/oil-crisis-platform-final";

/** The footer of every page: the disclaimer, a short list of the sources that are on, the repository link, and (one click) the full attributions,
 * the TradingView note and the privacy note. All text comes from the backend's /api/v1/hosted so it cannot disagree with what is enabled. */
export default function SiteFooter() {
  const cfg = useHosted();
  const on = cfg ? Object.entries(cfg.sources).filter(([, s]) => s.enabled && s.attribution) : [];
  return (
    <footer data-testid="site-footer" role="contentinfo" className="shrink-0" style={{ borderTop: "1px solid rgba(244,241,234,0.12)", background: "var(--color-void)", color: "var(--color-ash)", padding: "8px 16px", fontSize: 11, lineHeight: 1.5 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", alignItems: "baseline" }}>
        <span data-testid="footer-disclaimer" style={{ color: "var(--color-bone)" }}>{cfg?.disclaimer ?? FALLBACK_DISCLAIMER}</span>
        {on.length > 0 && <span data-testid="footer-sources">Data: {on.map(([, s]) => s.label).join(" · ")}</span>}
        {cfg?.vessels === "SIMULATED_AND_SAVED_REAL" && cfg.hosted && cfg.sources.shipfinder_snapshot?.attribution && <span data-testid="footer-vessels">{cfg.sources.shipfinder_snapshot.attribution}</span>}
        {cfg?.vessels === "SIMULATED_ONLY" && <span data-testid="footer-vessels">Vessels on this site are SIMULATED.</span>}
        {cfg?.voyage_distances === "estimated" && <span data-testid="footer-distances">Voyage lengths are estimates.</span>}
        <a href={cfg?.repo_url ?? FALLBACK_REPO} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-crude)", textDecoration: "underline", display: "inline-block", padding: "5px 0", minHeight: 24 }}>Source code</a>
      </div>
      <details data-testid="footer-details" style={{ marginTop: 2 }}>
        <summary style={{ cursor: "pointer", color: "var(--color-bone)", minHeight: 24, display: "inline-flex", alignItems: "center" }}>Sources, privacy and licences</summary>
        <div style={{ maxHeight: "40vh", overflowY: "auto", paddingTop: 4 }}>
          {on.map(([k, s]) => (
            <p key={k} data-testid={`footer-attr-${k}`} style={{ margin: "0 0 4px" }}>
              {s.attribution}{s.url && <> <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-crude)" }}>{s.url.replace(/^https?:\/\//, "")}</a></>}
            </p>
          ))}
          {cfg && <p data-testid="footer-privacy" style={{ margin: "0 0 4px" }}>{cfg.privacy}</p>}
          <p style={{ margin: 0 }}>The code is under the MIT licence; data files keep the licences and terms of their sources.</p>
        </div>
      </details>
    </footer>
  );
}
