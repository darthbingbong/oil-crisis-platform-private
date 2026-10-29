export const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US");

/** 4,271,845 -> "4.27 M"; 2,348,202,000 -> "2.35 bn". */
export function fmtCompact(n: number, digits = 2): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(digits)} bn`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(digits)} M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(digits)} k`;
  return n.toFixed(digits);
}

/** Barrels per day as million barrels per day: 2 decimals, trailing zeros dropped (4,271,845 -> "4.27 Mb/d", 8,800,000 -> "8.8 Mb/d"). */
export function fmtMbd(bpd: number): string {
  return `${Number((bpd / 1e6).toFixed(2))} Mb/d`;
}

export const fmtSigned = (n: number, digits = 1): string => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;

export function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
