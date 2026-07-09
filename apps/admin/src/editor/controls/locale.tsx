import { useEffect, useState } from 'react'
import { useIndex } from '../../data/index-store'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@/components/ui/select'
import type { ControlProps } from './types'

const ANY = '__any__'

/** Friendly label for a locale code ("en" → "English (en)"), falling back to the raw code when
 *  Intl can't name it or the name would just repeat the code. Keeps the stored value the code. */
function localeLabel(code: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code)
    return name && name.toLowerCase() !== code.toLowerCase()
      ? `${name} (${code})`
      : code
  } catch {
    return code
  }
}

/** Single-select locale filter fed by the content index (`distinctLocales`) — the system already
 *  knows its locales, so the author picks one instead of typing a raw code (DoD #4). Empty value
 *  ("Any") clears the attr, mirroring CategoryControl. */
export function LocaleControl({ value, onChange, meta }: ControlProps) {
  const index = useIndex()
  const [locales, setLocales] = useState<string[]>([])
  useEffect(() => {
    let live = true
    void index
      .distinctLocales()
      .then((ls) => {
        if (live) setLocales(ls)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [index])

  const val = typeof value === 'string' ? value : ''
  return (
    <Select
      value={val || ANY}
      onValueChange={(v) => onChange(v === ANY ? '' : v)}
    >
      <SelectTrigger id={`bi-${meta.name}`} aria-label={meta.name}>
        <SelectValue placeholder="Any locale" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>Any locale</SelectItem>
        {locales.map((l) => (
          <SelectItem key={l} value={l}>
            {localeLabel(l)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
