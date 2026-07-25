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
  id,
  disabled = false
}: {
  value: string
  onChange: (text: string) => void
  onSubmit: (tag: string) => void
  exclude?: string[]
  placeholder?: string
  ariaLabel: string
  /** Forwarded to the combobox input to associate a visible `<label htmlFor>`. */
  id?: string
  disabled?: boolean
}) {
  const index = useIndex()
  const [matches, setMatches] = useState<string[]>([])
  // Kept SEPARATE from `matches` on purpose (#905, §4 row 22): the old `catch` set an
  // empty list, which renders identically to "no tag starts with that" — so a broken
  // lookup looked like a confident "this tag is new" exactly when the picker is least
  // trustworthy. Covered by apps/admin/test/tag-autocomplete.test.tsx.
  const [lookupFailed, setLookupFailed] = useState(false)
  const excludeKey = exclude.join('\0')

  useEffect(() => {
    const q = value.trim()
    if (q === '') {
      setMatches([])
      setLookupFailed(false)
      return
    }
    let cancelled = false
    const excluded = new Set(excludeKey ? excludeKey.split('\0') : [])
    const timer = setTimeout(() => {
      void index
        .distinctTags(q, 8)
        .then((tags) => {
          if (cancelled) return
          setMatches(tags.filter((t) => !excluded.has(t)))
          setLookupFailed(false)
        })
        .catch(() => {
          if (cancelled) return
          setMatches([])
          setLookupFailed(true)
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
      id={id}
      disabled={disabled}
      // Inline rather than a toast: the effect re-runs on every keystroke, so a toast
      // per character would be noise and the next keypress is already the retry — which
      // the text now says out loud, since nothing else on screen reveals it (#914).
      // Wording pinned by apps/admin/test/tag-autocomplete.test.tsx.
      hint={
        lookupFailed
          ? 'Couldn’t load tag suggestions — keep typing to retry, or just type the tag you want.'
          : undefined
      }
    />
  )
}
