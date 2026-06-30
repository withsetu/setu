import { useEffect, useState } from 'react'
import { parseSettings, DEFAULT_SETTINGS } from '@setu/core'
import type { MediaSettings as MediaValues } from '@setu/core'
import { useServices, OWNER_AUTHOR } from '../../data/store'
import { useNotify } from '../../ui/notify'
import { useCapabilities } from '../../lib/useCapabilities'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

const SETTINGS_PATH = 'settings.json'
const apiBase = (import.meta.env.VITE_SETU_API as string | undefined) ?? ''

const FORMAT_OPTIONS: { value: MediaValues['imageFormat']; label: string }[] = [
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'both', label: 'Both (WebP + AVIF)' },
]

const sameMedia = (a: MediaValues, b: MediaValues) =>
  a.imageFormat === b.imageFormat && a.imageLqip === b.imageLqip

export function MediaSettings() {
  const { git } = useServices()
  const notify = useNotify()
  const { caps, loading: capsLoading } = useCapabilities()

  const [raw, setRaw] = useState<Record<string, unknown> | null>(null)
  const [values, setValues] = useState<MediaValues>(DEFAULT_SETTINGS.media)
  const [published, setPublished] = useState<MediaValues | null>(null)
  const [saving, setSaving] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)

  const canReprocess = !!caps && caps.imageProcessing && caps.writableMediaStore && caps.backgroundJobs
  const showUploadsNote = !capsLoading && caps !== null && !(caps.imageProcessing && caps.writableMediaStore)

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
      const media = parseSettings(parsedRaw).media
      if (live) {
        setRaw(parsedRaw)
        setValues(media)
        setPublished(media)
      }
    })()
    return () => {
      live = false
    }
  }, [git])

  const dirty = published !== null && !sameMedia(values, published)
  const set = (patch: Partial<MediaValues>) => setValues((v) => ({ ...v, ...patch }))

  const save = async () => {
    if (saving || !dirty || raw === null) return
    setSaving(true)
    try {
      const next = { ...raw, media: values }
      await git.commitFile({
        path: SETTINGS_PATH,
        content: JSON.stringify(next, null, 2) + '\n',
        message: 'chore(settings): update media settings',
        author: OWNER_AUTHOR,
      })
      setRaw(next)
      setPublished(values)
      notify.success('Settings saved')
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const reprocess = async () => {
    if (reprocessing) return
    setReprocessing(true)
    try {
      const res = await fetch(`${apiBase}/media/reprocess`, { method: 'POST' })
      if (!res.ok) throw new Error(`Reprocess failed: ${res.status}`)
      const data = (await res.json()) as { reprocessed: number }
      notify.success(`Reprocessed ${data.reprocessed} image${data.reprocessed === 1 ? '' : 's'}`)
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    } finally {
      setReprocessing(false)
    }
  }

  return (
    <div className="max-w-xl space-y-5">
      {/* Image format */}
      <div className="space-y-1.5">
        <Label htmlFor="med-format">Image format</Label>
        <Select
          value={values.imageFormat}
          onValueChange={(v) => set({ imageFormat: v as MediaValues['imageFormat'] })}
        >
          <SelectTrigger id="med-format" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMAT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Format used when processing uploaded images. AVIF is smaller but slower to encode.
        </p>
      </div>

      {/* LQIP switch */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="med-lqip">Blur-up placeholders (LQIP)</Label>
          <p className="text-xs text-muted-foreground">
            Generates a tiny blurred preview shown while the full image loads.
          </p>
        </div>
        <Switch
          id="med-lqip"
          checked={values.imageLqip}
          onCheckedChange={(c) => set({ imageLqip: c })}
        />
      </div>

      {/* Save button */}
      <Button
        onClick={() => void save()}
        disabled={published === null || !dirty || saving}
      >
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </Button>

      {/* Reprocess section */}
      <div className="border-t pt-5 space-y-2">
        <p className="text-sm font-medium">Reprocess all images</p>
        <p className="text-xs text-muted-foreground">
          Re-encodes every image in the media library using the current format and LQIP settings.
        </p>

        {!capsLoading && !canReprocess ? (
          <>
            <Button variant="outline" disabled>
              Reprocess all images
            </Button>
            <p className="text-xs text-muted-foreground">
              Image reprocessing runs in local or self-hosted mode. This site is served from the
              edge — run reprocess from your local Setu or your self-hosted server.
            </p>
          </>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Reprocess all images</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reprocess all images?</AlertDialogTitle>
                <AlertDialogDescription>
                  Re-encodes every image with the current format/LQIP settings. This is heavy —
                  especially AVIF — and is best run locally, not on a deployed site.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={reprocessing}
                  onClick={() => void reprocess()}
                >
                  {reprocessing ? 'Reprocessing…' : 'Reprocess'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {showUploadsNote && (
          <p className="text-xs text-muted-foreground">
            Uploads won't generate variants (WebP/AVIF/LQIP) in this deployment — image
            processing and writable media storage are not available on the edge.
          </p>
        )}
      </div>
    </div>
  )
}
