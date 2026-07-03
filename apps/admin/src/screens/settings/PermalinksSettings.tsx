import { useEffect, useMemo, useState } from 'react'
import {
  parseSettings,
  DEFAULT_SETTINGS,
  DEFAULT_PERMALINK_PATTERN,
  PERMALINK_TOKENS,
  validatePermalinkPattern,
  resolvePermalink
} from '@setu/core'
import type { PermalinksSettings as PermalinksValues } from '@setu/core'
import { useServices, OWNER_AUTHOR } from '../../data/store'
import { useNotify } from '../../ui/notify'
import { useRefreshSettings } from '../../data/settings-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@/components/ui/select'

const SETTINGS_PATH = 'settings.json'
const CUSTOM = '__custom__'

// The free-tier collection set from #251.
const COLLECTIONS: { id: string; label: string }[] = [
  { id: 'post', label: 'Posts' },
  { id: 'page', label: 'Pages' }
]

// WordPress-style presets. Order matches the brief.
const PRESETS: { id: string; label: string; pattern: string }[] = [
  { id: 'plain', label: 'Plain', pattern: DEFAULT_PERMALINK_PATTERN },
  { id: 'post-name', label: 'Post name', pattern: ':slug' },
  { id: 'day-name', label: 'Day and name', pattern: ':year/:month/:day/:slug' },
  { id: 'month-name', label: 'Month and name', pattern: ':year/:month/:slug' },
  { id: 'category-name', label: 'Category and name', pattern: ':category/:slug' }
]

const presetForPattern = (pattern: string): string =>
  PRESETS.find((p) => p.pattern === pattern)?.id ?? CUSTOM

const SAMPLE_REF = {
  collection: 'post',
  locale: 'en',
  slug: 'my-first-post',
  date: Date.UTC(2026, 2, 9), // 2026-03-09
  categories: ['news']
}

const VALID_SLUG = /^[a-z0-9-]+$/

const sameValues = (a: PermalinksValues, b: PermalinksValues) =>
  a.uncategorized === b.uncategorized &&
  JSON.stringify(a.patterns) === JSON.stringify(b.patterns)

/** One collection's preset + custom-pattern + preview + validation. Absence in
 *  `pattern` means "inherit config/default" — an untouched "Plain" row never writes. */
function CollectionRow({
  id,
  label,
  pattern,
  uncategorized,
  onChange
}: {
  id: string
  label: string
  pattern: string | undefined
  uncategorized: string
  onChange: (next: string | undefined) => void
}) {
  const effectivePattern = pattern ?? DEFAULT_PERMALINK_PATTERN
  const presetId = pattern === undefined ? 'plain' : presetForPattern(pattern)
  const isCustom = presetId === CUSTOM

  const errors = isCustom ? validatePermalinkPattern(effectivePattern) : []
  const preview = useMemo(() => {
    if (errors.length > 0) return null
    return resolvePermalink(
      { ...SAMPLE_REF, collection: id },
      effectivePattern,
      { uncategorized }
    ).path
  }, [effectivePattern, errors.length, id, uncategorized])

  const setPreset = (next: string) => {
    if (next === CUSTOM) {
      // Free the input with the current effective pattern so nothing jumps.
      onChange(effectivePattern)
      return
    }
    const preset = PRESETS.find((p) => p.id === next)
    if (!preset) return
    // "Plain" == the default scheme; writing it explicitly is unnecessary — absence inherits it.
    onChange(preset.id === 'plain' ? undefined : preset.pattern)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`perma-${id}-preset`}>Structure</Label>
          <Select value={presetId} onValueChange={setPreset}>
            <SelectTrigger id={`perma-${id}-preset`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label} — <code>{p.pattern}</code>
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM}>Custom…</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isCustom && (
          <div className="space-y-1.5">
            <Label htmlFor={`perma-${id}-pattern`}>Custom pattern</Label>
            <Input
              id={`perma-${id}-pattern`}
              className="font-mono"
              value={effectivePattern}
              onChange={(e) => onChange(e.target.value)}
              placeholder={DEFAULT_PERMALINK_PATTERN}
              aria-invalid={errors.length > 0}
            />
            <p className="text-xs text-muted-foreground">
              Tokens: {PERMALINK_TOKENS.map((t) => (
                <code key={t} className="mr-1.5">
                  {t}
                </code>
              ))}
            </p>
            {errors.length > 0 && (
              <ul className="space-y-0.5 text-xs text-destructive">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Preview</Label>
          <p className="font-mono text-sm text-muted-foreground">
            {preview ? `example.com/${preview}` : '—'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export function PermalinksSettings() {
  const { git } = useServices()
  const notify = useNotify()
  const refreshSettings = useRefreshSettings()
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null)
  const [values, setValues] = useState<PermalinksValues>(
    DEFAULT_SETTINGS.permalinks
  )
  const [published, setPublished] = useState<PermalinksValues | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      const content = await git.readFile(SETTINGS_PATH)
      let parsedRaw: Record<string, unknown> = {}
      try {
        parsedRaw = content
          ? (JSON.parse(content) as Record<string, unknown>)
          : {}
      } catch {
        parsedRaw = {}
      }
      const permalinks = parseSettings(parsedRaw).permalinks
      if (live) {
        setRaw(parsedRaw)
        setValues(permalinks)
        setPublished(permalinks)
      }
    })()
    return () => {
      live = false
    }
  }, [git])

  const setPattern = (collection: string, pattern: string | undefined) =>
    setValues((v) => {
      const patterns = { ...v.patterns }
      if (pattern === undefined) delete patterns[collection]
      else patterns[collection] = pattern
      return { ...v, patterns }
    })

  const setUncategorized = (next: string) =>
    setValues((v) => ({ ...v, uncategorized: next }))

  const uncategorizedError =
    values.uncategorized.trim() === ''
      ? 'category base must not be empty'
      : !VALID_SLUG.test(values.uncategorized)
        ? 'category base must be lowercase letters, digits, or hyphens'
        : null

  const patternErrors = COLLECTIONS.reduce<Record<string, string[]>>(
    (acc, c) => {
      const pattern = values.patterns[c.id]
      acc[c.id] = pattern !== undefined ? validatePermalinkPattern(pattern) : []
      return acc
    },
    {}
  )
  const hasInvalid =
    Object.values(patternErrors).some((e) => e.length > 0) ||
    uncategorizedError !== null

  const dirty = published !== null && !sameValues(values, published)

  const save = async () => {
    if (saving || !dirty || hasInvalid || raw === null) return
    setSaving(true)
    try {
      // Drop any entry equal to the default scheme (untouched "Plain") — absence means
      // "inherit config/default" (see PermalinksSettings brief + resolvePermalinkConfig).
      const patterns: Record<string, string> = {}
      for (const [collection, pattern] of Object.entries(values.patterns)) {
        if (pattern !== DEFAULT_PERMALINK_PATTERN) patterns[collection] = pattern
      }
      const cleaned: PermalinksValues = {
        patterns,
        uncategorized: values.uncategorized.trim()
      }
      const next = { ...raw, permalinks: cleaned } // preserve unknown groups
      await git.commitFile({
        path: SETTINGS_PATH,
        content: JSON.stringify(next, null, 2) + '\n',
        message: 'chore(settings): update permalink settings',
        author: OWNER_AUTHOR
      })
      setRaw(next)
      setValues(cleaned)
      setPublished(cleaned)
      refreshSettings()
      notify.success('Settings saved')
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Changing permalinks updates URLs on the next site build/deploy.
        Existing links keep working after increment C ships automatic
        redirects — until then, changed URLs are NOT redirected.
      </p>

      <div className="space-y-4">
        {COLLECTIONS.map((c) => (
          <CollectionRow
            key={c.id}
            id={c.id}
            label={c.label}
            pattern={values.patterns[c.id]}
            uncategorized={values.uncategorized}
            onChange={(next) => setPattern(c.id, next)}
          />
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="perma-uncategorized">Category base</Label>
        <Input
          id="perma-uncategorized"
          value={values.uncategorized}
          onChange={(e) => setUncategorized(e.target.value)}
          placeholder="uncategorized"
          aria-invalid={uncategorizedError !== null}
        />
        <p className="text-xs text-muted-foreground">
          Used in place of <code>:category</code> when an entry has no
          category.
        </p>
        {uncategorizedError && (
          <p className="text-xs text-destructive">{uncategorizedError}</p>
        )}
      </div>

      <Button
        onClick={() => void save()}
        disabled={published === null || !dirty || hasInvalid || saving}
      >
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </Button>
    </div>
  )
}
