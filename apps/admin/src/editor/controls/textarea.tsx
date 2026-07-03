import { Textarea } from '@/components/ui/textarea'
import { toDisplayString, type ControlProps } from './types'

export function TextareaControl({ value, onChange, meta }: ControlProps) {
  return (
    <Textarea
      id={`bi-${meta.name}`}
      aria-label={meta.name}
      value={toDisplayString(value, '')}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
