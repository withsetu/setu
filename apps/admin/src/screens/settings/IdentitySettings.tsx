import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { parseSettings, DEFAULT_SETTINGS } from '@setu/core'
import type { IdentitySettings as IdentityValues } from '@setu/core'
import { useServices, OWNER_AUTHOR } from '../../data/store'
import { useNotify } from '../../ui/notify'
import { useRefreshSettings } from '../../data/settings-store'
import { MediaPickerModal } from '../../editor/MediaPickerModal'
import { resolveMediaSrc } from '../../editor/media-src'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@/components/ui/select'

const SETTINGS_PATH = 'settings.json'
const apiBase = import.meta.env.VITE_SETU_API ?? ''
const SEPARATORS = ['·', '-', '–', '—', '|', '•', '/']

const sameIdentity = (a: IdentityValues, b: IdentityValues) =>
  a.entityType === b.entityType &&
  a.name === b.name &&
  a.url === b.url &&
  a.logo === b.logo &&
  a.defaultImage === b.defaultImage &&
  a.twitterHandle === b.twitterHandle &&
  a.titleTemplate === b.titleTemplate &&
  a.titleSeparator === b.titleSeparator &&
  a.socialProfiles.length === b.socialProfiles.length &&
  a.socialProfiles.every((p, i) => p === b.socialProfiles[i])

/** A labelled image field backed by the shared media picker — never a raw path input. */
function ImageField({
  label,
  hint,
  value,
  variant,
  onChange
}: {
  label: string
  hint?: string
  value: string
  variant: 'logo' | 'cover'
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {value ? (
        <div className="space-y-2">
          <img
            src={resolveMediaSrc(value, apiBase)}
            alt={`${label} preview`}
            className={
              variant === 'cover'
                ? 'aspect-video w-full max-w-sm rounded-md border border-border/60 object-cover'
                : 'h-20 rounded-md border border-border/60 bg-muted/30 object-contain p-1'
            }
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setOpen(true)}
            >
              Change
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              onClick={() => onChange('')}
            >
              <X className="size-3" /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setOpen(true)}
        >
          Choose image
        </Button>
      )}
      <MediaPickerModal
        apiBase={apiBase}
        open={open}
        onClose={() => setOpen(false)}
        onPick={(src) => {
          onChange(src)
          setOpen(false)
        }}
      />
    </div>
  )
}

export function IdentitySettings() {
  const { git } = useServices()
  const notify = useNotify()
  const refreshSettings = useRefreshSettings()
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null)
  const [values, setValues] = useState<IdentityValues>(
    DEFAULT_SETTINGS.identity
  )
  const [published, setPublished] = useState<IdentityValues | null>(null)
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
      const identity = parseSettings(parsedRaw).identity
      if (live) {
        setRaw(parsedRaw)
        setValues(identity)
        setPublished(identity)
      }
    })()
    return () => {
      live = false
    }
  }, [git])

  const dirty = published !== null && !sameIdentity(values, published)
  const set = (patch: Partial<IdentityValues>) =>
    setValues((v) => ({ ...v, ...patch }))

  const setSocial = (i: number, next: string) =>
    setValues((v) => ({
      ...v,
      socialProfiles: v.socialProfiles.map((p, idx) => (idx === i ? next : p))
    }))
  const addSocial = () =>
    setValues((v) => ({ ...v, socialProfiles: [...v.socialProfiles, ''] }))
  const removeSocial = (i: number) =>
    setValues((v) => ({
      ...v,
      socialProfiles: v.socialProfiles.filter((_, idx) => idx !== i)
    }))

  const save = async () => {
    if (saving || !dirty || raw === null) return
    setSaving(true)
    try {
      // Drop blank social rows on save so the stored sameAs stays clean.
      const cleaned: IdentityValues = {
        ...values,
        socialProfiles: values.socialProfiles
          .map((p) => p.trim())
          .filter(Boolean),
        twitterHandle: values.twitterHandle.replace(/^@+/, '').trim()
      }
      const next = { ...raw, identity: cleaned } // preserve unknown groups
      await git.commitFile({
        path: SETTINGS_PATH,
        content: JSON.stringify(next, null, 2) + '\n',
        message: 'chore(settings): update identity / SEO settings',
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
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">Publisher</h3>
        <div className="space-y-1.5">
          <Label htmlFor="id-type">This site represents a…</Label>
          <Select
            value={values.entityType}
            onValueChange={(v) =>
              set({ entityType: v as IdentityValues['entityType'] })
            }
          >
            <SelectTrigger id="id-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organization">Organization</SelectItem>
              <SelectItem value="person">Person</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="id-name">Name</Label>
          <Input
            id="id-name"
            value={values.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Defaults to the site title"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="id-url">Website URL</Label>
          <Input
            id="id-url"
            value={values.url}
            onChange={(e) => set({ url: e.target.value })}
            placeholder="https://example.com"
          />
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">Branding</h3>
        <ImageField
          label="Logo"
          hint="Used for structured data and the RSS feed image."
          value={values.logo}
          variant="logo"
          onChange={(v) => set({ logo: v })}
        />
        <ImageField
          label="Default share image"
          hint="Fallback Open Graph / Twitter image for pages without their own."
          value={values.defaultImage}
          variant="cover"
          onChange={(v) => set({ defaultImage: v })}
        />
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">Social</h3>
        <div className="space-y-1.5">
          <Label htmlFor="id-twitter">Twitter / X handle</Label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">@</span>
            <Input
              id="id-twitter"
              value={values.twitterHandle}
              onChange={(e) =>
                set({ twitterHandle: e.target.value.replace(/^@+/, '') })
              }
              placeholder="yoursite"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Social profiles</Label>
          <p className="text-xs text-muted-foreground">
            Profile URLs (schema.org <code>sameAs</code>) — e.g. GitHub,
            LinkedIn, Mastodon.
          </p>
          <div className="space-y-2">
            {values.socialProfiles.map((p, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={p}
                  onChange={(e) => setSocial(i, e.target.value)}
                  placeholder="https://github.com/yourname"
                  aria-label={`Social profile ${i + 1}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground"
                  onClick={() => removeSocial(i)}
                  aria-label={`Remove social profile ${i + 1}`}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addSocial}
          >
            Add profile
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          Title format
        </h3>
        <div className="space-y-1.5">
          <Label htmlFor="id-title-tpl">Title template</Label>
          <Input
            id="id-title-tpl"
            value={values.titleTemplate}
            onChange={(e) => set({ titleTemplate: e.target.value })}
            placeholder="{{title}} {{separator}} {{site}}"
          />
          <p className="text-xs text-muted-foreground">
            Tokens: <code>{'{{title}}'}</code> <code>{'{{separator}}'}</code>{' '}
            <code>{'{{site}}'}</code>
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="id-sep">Separator</Label>
          <Select
            value={values.titleSeparator}
            onValueChange={(v) => set({ titleSeparator: v })}
          >
            <SelectTrigger id="id-sep" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                values.titleSeparator,
                ...SEPARATORS.filter((s) => s !== values.titleSeparator)
              ].map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <Button
        onClick={() => void save()}
        disabled={published === null || !dirty || saving}
      >
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </Button>
    </div>
  )
}
