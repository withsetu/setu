import { Input } from '@/components/ui/input'
import { toDisplayString, type ControlProps } from './types'

export function TextControl({ value, onChange, meta }: ControlProps) {
  return (
    <Input
      id={`bi-${meta.name}`}
      aria-label={meta.name}
      value={toDisplayString(value, '')}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
export function UrlControl({ value, onChange, meta }: ControlProps) {
  return (
    <Input
      id={`bi-${meta.name}`}
      aria-label={meta.name}
      type="url"
      value={toDisplayString(value, '')}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
export function NumberControl({ value, onChange, meta }: ControlProps) {
  // Numeric attrs are stored as real numbers (and defaults arrive as numbers) —
  // toDisplayString alone would render them as '' and the input would sit blank
  // while the preview obeys the value (#192 UAT catch).
  const display =
    typeof value === 'number' ? String(value) : toDisplayString(value, '')
  // Contract bounds (zod .min/.max) clamp here so the author SEES the effective
  // value instead of a silent render-time clamp. Empty stays '' = "unset".
  const clamp = (n: number): number => {
    let out = n
    if (meta.min !== undefined) out = Math.max(meta.min, out)
    if (meta.max !== undefined) out = Math.min(meta.max, out)
    return out
  }
  return (
    <Input
      id={`bi-${meta.name}`}
      aria-label={meta.name}
      type="number"
      min={meta.min}
      max={meta.max}
      value={display}
      onChange={(e) =>
        onChange(e.target.value === '' ? '' : clamp(Number(e.target.value)))
      }
    />
  )
}
