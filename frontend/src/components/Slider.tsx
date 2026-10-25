interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
  /** Greyed out and not draggable, e.g. when the value is derived from a route scenario. */
  disabled?: boolean;
}

/**
 * Wraps a native <input type="range"> with a 44px-tall padded hit area
 * (touch target min) while keeping the visible track a thin hairline, and
 * an explicit aria-label since the on-screen label isn't a <label for=...>
 * (it doubles as the live value readout).
 */
export default function Slider({ label, value, min, max, step, unit, onChange, disabled = false }: Props) {
  return (
    <div style={{ opacity: disabled ? 0.55 : 1 }}>
      <div className="flex justify-between items-baseline mb-2">
        <span className="section-label">
          {label}
          {disabled && <span style={{ marginLeft: 6, textTransform: "none", fontWeight: 400 }}>(from route)</span>}
        </span>
        <span className="data-readout text-base" style={{ color: "var(--color-crude)" }}>
          {value}
          {unit}
        </span>
      </div>
      <div className="flex items-center h-11">
        <input
          type="range"
          className="terminal-slider w-full"
          aria-label={label}
          aria-valuetext={`${value}${unit}`}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
