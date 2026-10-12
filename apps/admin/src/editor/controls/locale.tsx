import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DEFAULT_LOCALE } from '@setu/core'
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

/** What an unset locale resolves to on the published Query / Latest Posts blocks: they list
 *  `DEFAULT_LOCALE` only, never every locale (#1245) — so the unset option says so. */
const UNSET_LABEL = `Site default (${DEFAULT_LOCALE})`

/** Single-select locale filter fed by the content index (`distinctLocales`) — the system already
 *  knows its locales, so the author picks one instead of typing a raw code (DoD #4). The unset
 *  option clears the attr, mirroring CategoryControl. */
export function LocaleControl({ value, onChange, meta }: ControlProps) {
  const index = useIndex()
  const [locales, setLocales] = useState<string[]>([])
  // 'error' is a state of its own (#971): a failed read must not render the same one-item
  // picker as a genuinely single-locale site. Shape mirrors QueryPreview's 'error' state.
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    index
      .distinctLocales()
      .then((ls) => {
        if (!live) return
        setLocales(ls)
        setLoad('ready')
      })
      .catch(() => {
        if (live) setLoad('error')
      })
    return () => {
      live = false
    }
  }, [index, attempt])

  const id = `${meta.idPrefix ?? 'bi'}-${meta.name}`
  const errorId = `${id}-error`
  const val = typeof value === 'string' ? value : ''
  return (
    <div className="grid gap-1.5">
      <Select
        value={val || ANY}
        onValueChange={(v) => onChange(v === ANY ? '' : v)}
      >
        <SelectTrigger
          id={id}
          aria-label={meta.name}
          aria-busy={load === 'loading' || undefined}
          aria-invalid={load === 'error' || undefined}
          aria-describedby={load === 'error' ? errorId : undefined}
        >
          <SelectValue placeholder={UNSET_LABEL} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{UNSET_LABEL}</SelectItem>
          {locales.map((l) => (
            <SelectItem key={l} value={l}>
              {localeLabel(l)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {load === 'error' && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span id={errorId} className="text-destructive">
            Couldn’t load the site’s locales.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLoad('loading')
              setAttempt((a) => a + 1)
            }}
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  )
}
