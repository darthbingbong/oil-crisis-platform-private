import { useEffect, useRef, useState } from "react";
import { TV_HOME } from "../lib/markets";

type WidgetState = "loading" | "ready" | "unavailable";

const GIVE_UP_MS = 15000;

/**
 * One TradingView embed widget. The script is added only when this component mounts (the Markets panel mounts it only for the open tab), so nothing is
 * downloaded from TradingView until a visitor looks at the Markets panel. If the script fails, the network is offline or no frame appears within 15 s, the
 * card says "widget unavailable" and shows no number. TradingView's attribution link stays visible under the widget.
 */
export default function TradingViewWidget({ scriptSrc, config, height, title }: { scriptSrc: string; config: Record<string, unknown>; height: number; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const [state, setState] = useState<WidgetState>(offline ? "unavailable" : "loading");

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (offline) return;
    let poll: number | undefined;
    // Injection waits a moment: React StrictMode (development) mounts, unmounts and re-mounts at once, and TradingView's script throws if it runs after its
    // element was removed. A cleanup inside this delay cancels the injection before anything is added.
    const inject = window.setTimeout(() => {
    el.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    el.appendChild(widget);
    const script = document.createElement("script");
    script.src = scriptSrc;
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify(config);
    script.onerror = () => setState("unavailable");
    el.appendChild(script);

    // the widget script adds an iframe; its appearance is our "loaded" signal (we cannot see inside it)
    const started = Date.now();
    poll = window.setInterval(() => {
      if (el.querySelector("iframe")) { setState("ready"); window.clearInterval(poll); }
      else if (Date.now() - started > GIVE_UP_MS) { setState("unavailable"); window.clearInterval(poll); }
    }, 400);
    }, 60);
    return () => { window.clearTimeout(inject); if (poll !== undefined) window.clearInterval(poll); el.innerHTML = ""; };
  }, [scriptSrc, config, offline]);

  return (
    <div data-testid="tv-widget" data-state={state} className="tradingview-widget-container" style={{ minHeight: state === "unavailable" ? 0 : height }}>
      <div ref={host} style={{ display: state === "unavailable" ? "none" : "block", height }} aria-label={title} />
      {state === "loading" && <div className="text-xs" style={{ color: "var(--color-ash)", padding: "8px 0" }}>Loading TradingView widget...</div>}
      {state === "unavailable" && (
        <div role="status" data-testid="tv-unavailable" className="text-xs" style={{ color: "var(--color-crude)", padding: "10px 12px", border: "1px solid rgba(232,135,30,0.35)", borderRadius: 4 }}>
          Widget unavailable: TradingView could not be reached from this browser, so no quotes are shown here (nothing is estimated in their place).
        </div>
      )}
      <div className="tradingview-widget-copyright text-[11px]" style={{ marginTop: 4 }}>
        <a data-testid="tv-attribution" href={TV_HOME} rel="noopener nofollow noreferrer" target="_blank" style={{ color: "var(--color-lane)" }}>Track all markets on TradingView</a>
      </div>
    </div>
  );
}
