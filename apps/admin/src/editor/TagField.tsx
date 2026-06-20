import { useEffect, useState } from 'react'
import { normalizeTag } from '@setu/core'
import { useIndex } from '../data/index-store'

const SUGGESTION_LIMIT = 8

export function TagField({
  selected,
  onChange,
  editable,
}: {
  selected: string[]
  onChange: (next: string[]) => void
  editable: boolean
}) {
  const index = useIndex()
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])

  useEffect(() => {
    const q = input.trim()
    if (q === '') {
      setSuggestions([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void index
        .distinctTags(q, SUGGESTION_LIMIT)
        .then((tags) => {
          if (!cancelled) setSuggestions(tags.filter((t) => !selected.includes(t)))
        })
        .catch(() => {
          if (!cancelled) setSuggestions([])
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [input, index, selected])

  const add = (raw: string) => {
    const tag = normalizeTag(raw)
    setInput('')
    setSuggestions([])
    if (!tag || selected.includes(tag)) return
    onChange([...selected, tag])
  }

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
      <div className="tag-input-wrap">
        <input
          type="text"
          className="tag-input"
          placeholder="Add a tag"
          aria-label="Add a tag"
          value={input}
          disabled={!editable}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(input)
            }
          }}
        />
        {suggestions.length > 0 && (
          <ul className="tag-suggestions" role="listbox">
            {suggestions.map((tag) => (
              <li key={tag}>
                <button type="button" className="tag-suggestion" role="option" aria-selected={false} onClick={() => add(tag)}>
                  {tag}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
