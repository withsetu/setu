import { useEffect, useState } from 'react'
import { parseSettings, DEFAULT_SETTINGS, type ReadingSettings as ReadingValues } from '@setu/core'
import { useServices, OWNER_AUTHOR } from '../../data/store'
import { useRefreshSettings } from '../../data/settings-store'
import { useIndex } from '../../data/index-store'
import { useNotify } from '../../ui/notify'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'

const SETTINGS_PATH = 'settings.json'
const PAGE_SIZES = [10, 25, 50, 100]

const sameReading = (a: ReadingValues, b: ReadingValues) =>
  a.homepage === b.homepage &&
  a.searchEngineVisible === b.searchEngineVisible &&
  a.listPageSize === b.listPageSize

export function ReadingSettings() {
  const { git } = useServices()
  const notify = useNotify()
  const refreshSettings = useRefreshSettings()
  const index = useIndex()
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null)
  const [values, setValues] = useState<ReadingValues>(DEFAULT_SETTINGS.reading)
  const [published, setPublished] = useState<ReadingValues | null>(null)
  const [saving, setSaving] = useState(false)
  const [pages, setPages] = useState<{ id: string; title: string }[]>([])

  useEffect(() => {
    let live = true
    void (async () => {
      const content = await git.readFile(SETTINGS_PATH)
      let parsedRaw: Record<string, unknown> = {}
      try {
        parsedRaw = content ? (JSON.parse(content) as Record<string, unknown>) : {}
      } catch {
        parsedRaw = {}
      }
      const reading = parseSettings(parsedRaw).reading
      if (live) {
        setRaw(parsedRaw)
        setValues(reading)
        setPublished(reading)
      }
    })()
    return () => {
      live = false
    }
  }, [git])

  useEffect(() => {
    let live = true
    void (async () => {
      await index.ensureBuilt()
      const r = await index.query({
        collection: 'page',
        offset: 0,
        limit: 1000,
        sort: { key: 'title', dir: 'asc' },
      })
      if (live) {
        setPages(
          r.rows.map((row) => ({
            id: `${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`,
            title: row.title,
          })),
        )
      }
    })()
    return () => {
      live = false
    }
  }, [index])

  const dirty = published !== null && !sameReading(values, published)
  const set = (patch: Partial<ReadingValues>) => setValues((v) => ({ ...v, ...patch }))

  const save = async () => {
    if (saving || !dirty || raw === null) return
    setSaving(true)
    try {
      const next = { ...raw, reading: values }
      await git.commitFile({
        path: SETTINGS_PATH,
        content: JSON.stringify(next, null, 2) + '\n',
        message: 'chore(settings): update reading settings',
        author: OWNER_AUTHOR,
      })
      setRaw(next)
      setPublished(values)
      notify.success('Settings saved')
      refreshSettings()
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // Ensure the current homepage value is always selectable, even if it isn't a page.
  const homepageOptions =
    values.homepage === '' || pages.some((p) => p.id === values.homepage)
      ? pages
      : [{ id: values.homepage, title: values.homepage }, ...pages]

  return (
    <div className="max-w-xl space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="rd-home">Homepage</Label>
        <Select value={values.homepage} onValueChange={(v) => set({ homepage: v })}>
          <SelectTrigger id="rd-home">
            <SelectValue placeholder="Choose a page" />
          </SelectTrigger>
          <SelectContent>
            {homepageOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title || p.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">The page shown at your site root (/).</p>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="rd-noindex">Discourage search engines from indexing</Label>
        <Switch
          id="rd-noindex"
          checked={!values.searchEngineVisible}
          onCheckedChange={(c) => set({ searchEngineVisible: !c })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rd-size">Items per page (content lists)</Label>
        <Select
          value={String(values.listPageSize)}
          onValueChange={(v) => set({ listPageSize: Number(v) })}
        >
          <SelectTrigger id="rd-size" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[values.listPageSize, ...PAGE_SIZES.filter((s) => s !== values.listPageSize)]
              .sort((a, b) => a - b)
              .map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <Button onClick={() => void save()} disabled={published === null || !dirty || saving}>
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </Button>
    </div>
  )
}
