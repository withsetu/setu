import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import type { ControlProps } from './types'

export function SelectControl({ value, onChange, meta }: ControlProps) {
  return (
    <Select value={String(value ?? '')} onValueChange={(v) => onChange(v)}>
      <SelectTrigger id={`bi-${meta.name}`} aria-label={meta.name}><SelectValue /></SelectTrigger>
      <SelectContent>
        {(meta.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
