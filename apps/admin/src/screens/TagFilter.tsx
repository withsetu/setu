import { useState } from 'react'
import { TagAutocomplete } from '../ui/TagAutocomplete'

export function TagFilter({ value, onChange }: { value: string; onChange: (tag: string) => void }) {
  const [input, setInput] = useState('')

  if (value) {
    return (
      <span className="tag-chip">
        {value}
        <button type="button" className="tag-chip-x" aria-label="Clear tag filter" onClick={() => onChange('')}>
          ×
        </button>
      </span>
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
