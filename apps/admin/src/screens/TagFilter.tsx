import { useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TagAutocomplete } from '../ui/TagAutocomplete'

export function TagFilter({
  value,
  onChange
}: {
  value: string
  onChange: (tag: string) => void
}) {
  const [input, setInput] = useState('')

  if (value) {
    return (
      <Badge variant="secondary" className="gap-1">
        {value}
        <button
          type="button"
          aria-label="Clear tag filter"
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
      onSubmit={(tag) => {
        onChange(tag)
        setInput('')
      }}
      placeholder="Filter by tag"
      ariaLabel="Filter by tag"
    />
  )
}
