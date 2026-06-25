import { useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
    <div className="space-y-2.5">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1 font-normal">
              {tag}
              {editable && (
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  onClick={() => remove(tag)}
                  className="rounded-sm opacity-70 hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
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
