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
  return (
    <Input
      id={`bi-${meta.name}`}
      aria-label={meta.name}
      type="number"
      value={toDisplayString(value, '')}
      onChange={(e) =>
        onChange(e.target.value === '' ? '' : Number(e.target.value))
      }
    />
  )
}
