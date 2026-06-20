import { useEffect, useState } from 'react'
import { useIndex } from '../data/index-store'

export function TagFilter({ value, onChange }: { value: string; onChange: (tag: string) => void }) {
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
        .distinctTags(q, 8)
        .then((tags) => {
          if (!cancelled) setSuggestions(tags)
        })
        .catch(() => {
          if (!cancelled) setSuggestions([])
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [input, index])

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
    <div className="tag-filter tag-input-wrap">
      <input
        type="text"
        className="tag-input"
        placeholder="Filter by tag"
        aria-label="Filter by tag"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      {suggestions.length > 0 && (
        <div className="tag-suggestions" role="listbox">
          {suggestions.map((t) => (
            <button
              key={t}
              type="button"
              className="tag-suggestion"
              role="option"
              aria-selected={false}
              onClick={() => {
                onChange(t)
                setInput('')
                setSuggestions([])
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
