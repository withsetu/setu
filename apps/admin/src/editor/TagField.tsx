import { useState } from 'react'
import { TagAutocomplete } from '../ui/TagAutocomplete'

export function TagField({
  selected,
  onChange,
  editable,
}: {
  selected: string[]
  onChange: (next: string[]) => void
  editable: boolean
}) {
  const [input, setInput] = useState('')
  const remove = (tag: string) => onChange(selected.filter((t) => t !== tag))

  return (
    <div className="tag-field">
      <div className="tag-chips">
        {selected.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            {editable && (
              <button type="button" className="tag-chip-x" aria-label={`Remove ${tag}`} onClick={() => remove(tag)}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <TagAutocomplete
        value={input}
        onChange={setInput}
        onSubmit={(tag) => {
          if (!selected.includes(tag)) onChange([...selected, tag])
          setInput('')
        }}
        exclude={selected}
        placeholder="Add a tag"
        ariaLabel="Add a tag"
        disabled={!editable}
      />
    </div>
  )
}
