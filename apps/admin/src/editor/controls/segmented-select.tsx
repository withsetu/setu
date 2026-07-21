import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SelectControl } from './select'
import type { ControlProps } from './types'

export function SegmentedSelect(props: ControlProps) {
  const options = props.meta.options ?? []
  if (options.length === 0 || options.length > 4)
    return <SelectControl {...props} />
  const val = typeof props.value === 'string' ? props.value : ''
  return (
    <ToggleGroup
      type="single"
      value={val}
      spacing={1}
      onValueChange={(v) => {
        if (v) props.onChange(v)
      }}
      className="flex-wrap justify-start"
      aria-labelledby={`bi-label-${props.meta.name}`}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o}
          value={o}
          aria-label={o.replace(/-/g, ' ')}
          className="px-2.5 text-xs capitalize"
        >
          {o.replace(/-/g, ' ')}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
