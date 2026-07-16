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
  return (
    <Input
      id={`bi-${meta.name}`}
      aria-label={meta.name}
      type="number"
      value={display}
      onChange={(e) =>
        onChange(e.target.value === '' ? '' : Number(e.target.value))
      }
    />
  )
}
