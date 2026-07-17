import { Slider } from '@/components/ui/slider'
import type { ControlProps } from './types'

// Bounds come from the block contract (meta.min/max/step, lifted from the zod schema
// by resolveControls — e.g. spacer height 8–200). The 1–6 fallback preserves the
// original tuning for the query block's unconstrained `columns` prop.
const FALLBACK_MIN = 1
const FALLBACK_MAX = 6

export function SliderControl({ value, onChange, meta }: ControlProps) {
  const min = meta.min ?? FALLBACK_MIN
  const max = meta.max ?? FALLBACK_MAX
  const step = meta.step ?? 1
  const n = Math.min(max, Math.max(min, Number(value ?? meta.default) || min))
  return (
    <div className="flex items-center gap-3">
      <Slider
        id={`bi-${meta.name}`}
        aria-label={meta.name}
        min={min}
        max={max}
        step={step}
        value={[n]}
        onValueChange={([v]) => onChange(v)}
        className="flex-1"
      />
      <span className="min-w-8 text-right text-sm tabular-nums text-muted-foreground">
        {n}
      </span>
    </div>
  )
}
