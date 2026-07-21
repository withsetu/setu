import { useState } from 'react'
import { X } from 'lucide-react'
import { TagAutocomplete } from '../../ui/TagAutocomplete'
import { Badge } from '@/components/ui/badge'
import type { ControlProps } from './types'

/** Single-tag filter: a searchable picker (reuses TagAutocomplete); the chosen tag shows as a
 *  clearable chip. No raw-slug typing. */
export function TagControl({ value, onChange, meta }: ControlProps) {
  const [input, setInput] = useState('')
  const val = typeof value === 'string' ? value : ''
  if (val) {
    return (
      <Badge variant="secondary" className="w-fit gap-1 pr-1 font-normal">
        {val}
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
      ariaLabel={meta.name}
      id={`bi-${meta.name}`}
    />
  )
}
