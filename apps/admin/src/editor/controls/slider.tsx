import { Slider } from '@/components/ui/slider'
import type { ControlProps } from './types'

// Tuned for the query block's `columns` prop (1–6). The control framework doesn't carry a
// per-prop numeric range yet, so the bounds live here; revisit if another block needs a slider
// with a different range.
const MIN = 1
const MAX = 6

export function SliderControl({ value, onChange, meta }: ControlProps) {
  const n = Math.min(MAX, Math.max(MIN, Number(value ?? meta.default) || MIN))
  return (
    <div className="flex items-center gap-3">
      <Slider
        id={`bi-${meta.name}`}
        aria-label={meta.name}
        min={MIN}
        max={MAX}
        step={1}
        value={[n]}
        onValueChange={([v]) => onChange(v)}
        className="flex-1"
      />
      <span className="w-6 text-right text-sm tabular-nums text-muted-foreground">
        {n}
      </span>
    </div>
  )
}
