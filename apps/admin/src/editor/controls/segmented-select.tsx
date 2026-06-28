import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SelectControl } from './select'
import type { ControlProps } from './types'

export function SegmentedSelect(props: ControlProps) {
  const options = props.meta.options ?? []
  if (options.length === 0 || options.length > 4) return <SelectControl {...props} />
  return (
    <ToggleGroup type="single" value={String(props.value ?? '')}
      onValueChange={(v) => { if (v) props.onChange(v) }}
      className="flex-wrap justify-start gap-1" aria-label={props.meta.name}>
      {options.map((o) => (
        <ToggleGroupItem key={o} value={o} aria-label={o} className="px-2.5 text-xs capitalize">
          {o.replace(/-/g, ' ')}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
