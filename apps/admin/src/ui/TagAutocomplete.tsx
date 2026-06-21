import { useEffect, useState } from 'react'
import { normalizeTag } from '@setu/core'
import { useIndex } from '../data/index-store'
import { Combobox } from './Combobox'

export function TagAutocomplete({
  value,
  onChange,
  onSubmit,
  exclude = [],
  placeholder,
  ariaLabel,
  disabled = false,
}: {
  value: string
  onChange: (text: string) => void
  onSubmit: (tag: string) => void
  exclude?: string[]
  placeholder?: string
  ariaLabel: string
  disabled?: boolean
}) {
  const index = useIndex()
  const [matches, setMatches] = useState<string[]>([])
  const excludeKey = exclude.join('\0')

  useEffect(() => {
    const q = value.trim()
    if (q === '') {
      setMatches([])
      return
    }
    let cancelled = false
    const excluded = new Set(excludeKey ? excludeKey.split('\0') : [])
    const timer = setTimeout(() => {
      void index
        .distinctTags(q, 8)
        .then((tags) => {
          if (!cancelled) setMatches(tags.filter((t) => !excluded.has(t)))
        })
        .catch(() => {
          if (!cancelled) setMatches([])
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [value, index, excludeKey])

  return (
    <Combobox
      value={value}
      onChange={onChange}
      onSubmit={(text) => {
        const tag = normalizeTag(text)
        if (tag) onSubmit(tag)
      }}
      items={matches.map((v) => ({ value: v }))}
      allowFreeText
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      disabled={disabled}
    />
  )
}
