import { useEffect, useState } from 'react'
import { parseSettings, DEFAULT_SETTINGS } from '@setu/core'
import type { GeneralSettings as GeneralValues } from '@setu/core'
import { useServices, OWNER_AUTHOR } from '../../data/store'
import { useNotify } from '../../ui/notify'
import { connectionError } from '../../ui/error-message'
import { useRefreshSiteTitle } from '../../data/settings-store'
import {
  SettingsLoadError,
  SETTINGS_LOAD_FAILED_MESSAGE
} from './SettingsLoadError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@/components/ui/select'

const SETTINGS_PATH = 'settings.json'
const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney'
]
const DATE_FORMATS = [
  'MMM D, YYYY',
  'D MMM YYYY',
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY'
]

const sameGeneral = (a: GeneralValues, b: GeneralValues) =>
  a.title === b.title &&
  a.tagline === b.tagline &&
  a.description === b.description &&
  a.timezone === b.timezone &&
  a.dateFormat === b.dateFormat

export function GeneralSettings() {
  const { git } = useServices()
  const notify = useNotify()
  const refreshSiteTitle = useRefreshSiteTitle()
  // The full raw settings object (preserve unknown future groups on save).
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null)
  const [values, setValues] = useState<GeneralValues>(DEFAULT_SETTINGS.general)
  const [published, setPublished] = useState<GeneralValues | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        // Only git.readFile can reject here; a malformed (unparseable) file is deliberately
        // swallowed to {} → defaults, so it is NOT a load failure.
        const content = await git.readFile(SETTINGS_PATH)
        let parsedRaw: Record<string, unknown> = {}
        try {
          parsedRaw = content
            ? (JSON.parse(content) as Record<string, unknown>)
            : {}
        } catch {
          parsedRaw = {}
        }
        const general = parseSettings(parsedRaw).general
        if (!live) return
        setRaw(parsedRaw)
        setValues(general)
        setPublished(general)
        setLoadFailed(false)
      } catch (err) {
        if (!live) return
        console.error('[settings] reading general settings failed', err)
        setLoadFailed(true)
        notify.error(SETTINGS_LOAD_FAILED_MESSAGE)
      }
    })()
    return () => {
      live = false
    }
  }, [git, notify, retryKey])

  const dirty = published !== null && !sameGeneral(values, published)

  const set = (patch: Partial<GeneralValues>) =>
    setValues((v) => ({ ...v, ...patch }))

  const save = async () => {
    if (saving || !dirty || raw === null) return
    setSaving(true)
    try {
      const next = { ...raw, general: values } // preserve unknown groups
      await git.commitFile({
        path: SETTINGS_PATH,
        content: JSON.stringify(next, null, 2) + '\n',
        message: 'chore(settings): update general settings',
        author: OWNER_AUTHOR
      })
      setRaw(next)
      setPublished(values)
      notify.success('Settings saved')
      refreshSiteTitle() // update the admin document title immediately
    } catch {
      // #852: git.commitFile transport failure — curate rather than echo it.
      notify.error(connectionError('save your settings'))
    } finally {
      setSaving(false)
    }
  }

  if (loadFailed && published === null) {
    return (
      <SettingsLoadError
        onRetry={() => {
          setLoadFailed(false)
          setRetryKey((k) => k + 1)
        }}
      />
    )
  }

  return (
    <div className="max-w-xl space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="set-title">Site title</Label>
        <Input
          id="set-title"
          value={values.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Setu"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="set-tagline">Tagline</Label>
        <Input
          id="set-tagline"
          value={values.tagline}
          onChange={(e) => set({ tagline: e.target.value })}
          placeholder="A short tagline"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="set-desc">Description</Label>
        <Textarea
          id="set-desc"
          rows={3}
          value={values.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Used for the site meta description"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="set-tz">Timezone</Label>
          <Select
            value={values.timezone}
            onValueChange={(v) => set({ timezone: v })}
          >
            <SelectTrigger id="set-tz" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                values.timezone,
                ...TIMEZONES.filter((t) => t !== values.timezone)
              ].map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="set-df">Date format</Label>
          <Select
            value={values.dateFormat}
            onValueChange={(v) => set({ dateFormat: v })}
          >
            <SelectTrigger id="set-df" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                values.dateFormat,
                ...DATE_FORMATS.filter((d) => d !== values.dateFormat)
              ].map((df) => (
                <SelectItem key={df} value={df}>
                  {df}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button
        onClick={() => void save()}
        disabled={published === null || !dirty || saving}
      >
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </Button>
    </div>
  )
}
