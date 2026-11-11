import { useEffect, useState } from "react";
import { getHosted } from "../lib/api";
import type { HostedConfig } from "../types";

let cached: Promise<HostedConfig | null> | null = null;

/** The deployment's public facts (GET /api/v1/hosted), fetched once per page load. null while loading or when the backend cannot be reached:
 * the footer then falls back to its fixed disclaimer, so a missing backend never leaves the page without one. */
export function useHosted(): HostedConfig | null {
  const [cfg, setCfg] = useState<HostedConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    cached ??= getHosted().catch(() => null);
    cached.then((c) => { if (!cancelled) setCfg(c); });
    return () => { cancelled = true; };
  }, []);
  return cfg;
}
