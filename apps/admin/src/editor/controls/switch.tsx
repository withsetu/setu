import { Switch } from '@/components/ui/switch'
import type { ControlProps } from './types'

export function SwitchControl({ value, onChange, meta }: ControlProps) {
  return (
    <Switch
      id={`bi-${meta.name}`}
      aria-label={meta.name}
      checked={Boolean(value)}
      disabled={meta.disabled}
      onCheckedChange={(v) => onChange(v)}
    />
  )
}
