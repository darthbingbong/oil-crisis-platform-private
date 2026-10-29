import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TOKENS } from "../lib/constants";
import type { ConflictEvent } from "../types";

interface Props {
  conflicts: ConflictEvent[];
}

export default function HistoricalChart({ conflicts }: Props) {
  const data = useMemo(
    () =>
      conflicts
        .slice()
        .sort((a, b) => a.event_date.localeCompare(b.event_date))
        .map((c) => ({
          year: c.event_date.slice(0, 4),
          name: c.name,
          supply_loss_pct: c.supply_loss_pct,
          conflict_intensity: c.conflict_intensity,
        })),
    [conflicts]
  );

  return (
    <div>
      <div className="hairline mb-6" />
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-label" style={{ color: "var(--color-bone)" }}>
          Historical Events — Supply Loss vs Conflict Intensity
        </h2>
        <span className="data-readout text-xs" style={{ color: "var(--color-ash)" }}>
          {data.length} events, 1973–2026
        </span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="rgba(244,241,234,0.06)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="year"
            tick={{ fill: TOKENS.ash, fontSize: 11 }}
            axisLine={{ stroke: "rgba(244,241,234,0.12)" }}
            tickLine={false}
            interval={2}
          />
          <YAxis
            yAxisId="left"
            tick={{ fill: TOKENS.ash, fontSize: 11 }}
            axisLine={{ stroke: "rgba(244,241,234,0.12)" }}
            tickLine={false}
            width={30}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: TOKENS.ash, fontSize: 11 }}
            axisLine={{ stroke: "rgba(244,241,234,0.12)" }}
            tickLine={false}
            width={24}
          />
          <Tooltip
            contentStyle={{
              background: "#030303ee",
              border: "1px solid rgba(244,241,234,0.14)",
              borderRadius: 8,
              fontSize: 11,
            }}
            labelStyle={{ color: TOKENS.ash }}
            itemStyle={{ color: TOKENS.bone }}
          />
          <Bar yAxisId="left" dataKey="supply_loss_pct" fill={TOKENS.crude} radius={[2, 2, 0, 0]} name="Supply loss %" />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="conflict_intensity"
            stroke={TOKENS.alarm}
            strokeWidth={1.5}
            dot={false}
            name="Conflict intensity"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
