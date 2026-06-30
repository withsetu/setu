import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ControlProps } from './types'

const DEFAULT_OPTIONS = ['none', 'wide', 'full']

export function AlignControl({ value, onChange, meta }: ControlProps) {
  const options = meta.options ?? DEFAULT_OPTIONS
  const val = typeof value === 'string' ? value : ''
  return (
    <ToggleGroup type="single" value={val} spacing={1}
      onValueChange={(v) => { if (v) onChange(v) }}
      className="flex-wrap justify-start" aria-label={meta.name}>
      {options.map((o) => (
        <ToggleGroupItem key={o} value={o} aria-label={o.replace(/-/g, ' ')} className="px-2.5 text-xs capitalize">
          {o.replace(/-/g, ' ')}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
