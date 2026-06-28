import { Input } from '@/components/ui/input'
import type { ControlProps } from './types'

export function TextControl({ value, onChange, meta }: ControlProps) {
  return <Input id={`bi-${meta.name}`} aria-label={meta.name} value={String(value ?? '')}
    onChange={(e) => onChange(e.target.value)} />
}
export function UrlControl({ value, onChange, meta }: ControlProps) {
  return <Input id={`bi-${meta.name}`} aria-label={meta.name} type="url" value={String(value ?? '')}
    onChange={(e) => onChange(e.target.value)} />
}
export function NumberControl({ value, onChange, meta }: ControlProps) {
  return <Input id={`bi-${meta.name}`} aria-label={meta.name} type="number" value={String(value ?? '')}
    onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
}
