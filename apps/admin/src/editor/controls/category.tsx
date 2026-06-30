import { useTaxonomy } from '../../data/taxonomy-store'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import type { ControlProps } from './types'

const ANY = '__any__'

/** Single-select category filter: pick one existing category from the taxonomy, or "Any".
 *  No raw-slug typing. Empty value (Any) clears the attr. */
export function CategoryControl({ value, onChange, meta }: ControlProps) {
  const { categories } = useTaxonomy()
  const val = typeof value === 'string' ? value : ''
  return (
    <Select value={val || ANY} onValueChange={(v) => onChange(v === ANY ? '' : v)}>
      <SelectTrigger id={`bi-${meta.name}`} aria-label={meta.name}>
        <SelectValue placeholder="Any category" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>Any category</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c.slug} value={c.slug}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
