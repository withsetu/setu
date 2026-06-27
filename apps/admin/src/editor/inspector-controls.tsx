import { useState } from 'react'
import { X } from 'lucide-react'
import { useTaxonomy } from '../data/taxonomy-store'
import { TagAutocomplete } from '../ui/TagAutocomplete'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

const ANY = '__any__'

/** Single-select category filter for a block prop: pick one existing category from the
 *  taxonomy, or "Any". No raw-slug typing. Empty value (Any) clears the attr. */
export function CategoryControl({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (v: string) => void
}) {
  const { categories } = useTaxonomy()
  return (
    <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? '' : v)}>
      <SelectTrigger id={id} aria-label="Category">
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

/** Single-tag filter for a block prop: a searchable picker (reuses TagAutocomplete); the
 *  chosen tag shows as a clearable chip. No raw-slug typing. */
export function TagControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [input, setInput] = useState('')
  if (value) {
    return (
      <Badge variant="secondary" className="w-fit gap-1 pr-1 font-normal">
        {value}
        <button
          type="button"
          aria-label="Clear tag"
          className="rounded-sm opacity-70 hover:opacity-100"
          onClick={() => onChange('')}
        >
          <X className="size-3" />
        </button>
      </Badge>
    )
  }
  return (
    <TagAutocomplete
      value={input}
      onChange={setInput}
      onSubmit={(t) => {
        onChange(t)
        setInput('')
      }}
      placeholder="Search tags…"
      ariaLabel="Tag"
    />
  )
}
