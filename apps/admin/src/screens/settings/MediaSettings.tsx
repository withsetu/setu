import { useEffect, useRef, useState } from 'react'
import { parseSettings, DEFAULT_SETTINGS } from '@setu/core'
import type { MediaSettings as MediaValues } from '@setu/core'
import { useServices, OWNER_AUTHOR } from '../../data/store'
import { useNotify } from '../../ui/notify'
import { useCapabilities } from '../../lib/useCapabilities'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
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
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'

const SETTINGS_PATH = 'settings.json'
const apiBase = (import.meta.env.VITE_SETU_API) ?? ''

const FORMAT_OPTIONS: { value: MediaValues['imageFormat']; label: string }[] = [
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'both', label: 'Both (WebP + AVIF)' }
]

const sameMedia = (a: MediaValues, b: MediaValues) =>
  a.imageFormat === b.imageFormat && a.imageLqip === b.imageLqip

interface ReprocessStatus {
  status: 'idle' | 'running' | 'done' | 'failed'
  processed: number
  total: number
  error?: string
}

export function MediaSettings() {
  const { git } = useServices()
  const notify = useNotify()
  const { caps, loading: capsLoading } = useCapabilities()

  const [raw, setRaw] = useState<Record<string, unknown> | null>(null)
  const [values, setValues] = useState<MediaValues>(DEFAULT_SETTINGS.media)
  const [published, setPublished] = useState<MediaValues | null>(null)
  const [saving, setSaving] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  const [reprocessProgress, setReprocessProgress] = useState<{
    processed: number
    total: number
  } | null>(null)

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const canReprocess =
    !!caps &&
    caps.imageProcessing &&
    caps.writableMediaStore &&
    caps.backgroundJobs
  const showUploadsNote =
    !capsLoading &&
    caps !== null &&
    !(caps.imageProcessing && caps.writableMediaStore)

  const stopPolling = () => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  const handleReprocessStatus = (data: ReprocessStatus) => {
    if (!mountedRef.current) return
    if (data.status === 'running') {
      setReprocessProgress({ processed: data.processed, total: data.total })
    } else if (data.status === 'done') {
      stopPolling()
      setReprocessing(false)
      setReprocessProgress(null)
      notify.success(
        `Reprocessed ${data.processed} image${data.processed === 1 ? '' : 's'}`
      )
    } else if (data.status === 'failed') {
      stopPolling()
      setReprocessing(false)
      setReprocessProgress(null)
      notify.error(data.error ?? 'Reprocess failed')
    }
  }

  const startPolling = () => {
    stopPolling()
    pollIntervalRef.current = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`${apiBase}/api/media/reprocess/status`)
          if (!mountedRef.current) return
          if (!res.ok) return
          const data = (await res.json()) as ReprocessStatus
          handleReprocessStatus(data)
        } catch {
          // ignore transient poll errors
        }
      })()
    }, 1000)
  }

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

  // On mount, read status once to resume a job that may already be running
  useEffect(() => {
    mountedRef.current = true
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/media/reprocess/status`)
        if (!mountedRef.current || !res.ok) return
        const data = (await res.json()) as ReprocessStatus
        if (data.status === 'running') {
          setReprocessing(true)
          setReprocessProgress({ processed: data.processed, total: data.total })
          startPolling()
        }
      } catch {
        // no-op: status endpoint may not exist in all topologies
      }
    })()
    return () => {
      mountedRef.current = false
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty = published !== null && !sameMedia(values, published)
  const set = (patch: Partial<MediaValues>) =>
    setValues((v) => ({ ...v, ...patch }))

  const save = async () => {
    if (saving || !dirty || raw === null) return
    setSaving(true)
    try {
      const next = { ...raw, media: values }
      await git.commitFile({
        path: SETTINGS_PATH,
        content: JSON.stringify(next, null, 2) + '\n',
        message: 'chore(settings): update media settings',
        author: OWNER_AUTHOR
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
    setReprocessProgress({ processed: 0, total: 0 })
    try {
      const res = await fetch(`${apiBase}/api/media/reprocess`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error(`Reprocess failed: ${res.status}`)
      const data = (await res.json()) as {
        jobId: string
        status: string
        total: number
        processed: number
      }
      if (mountedRef.current) {
        setReprocessProgress({ processed: data.processed, total: data.total })
        startPolling()
      }
    } catch (e) {
      if (mountedRef.current) {
        setReprocessing(false)
        setReprocessProgress(null)
        notify.error(e instanceof Error ? e.message : String(e))
      }
    }
  }

  const progressValue =
    reprocessProgress && reprocessProgress.total > 0
      ? Math.round(
          (reprocessProgress.processed / reprocessProgress.total) * 100
        )
      : 0

  return (
    <div className="max-w-xl space-y-5">
      {/* Image format */}
      <div className="space-y-1.5">
        <Label htmlFor="med-format">Image format</Label>
        <Select
          value={values.imageFormat}
          onValueChange={(v) =>
            set({ imageFormat: v as MediaValues['imageFormat'] })
          }
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
          Format used when processing uploaded images. AVIF is smaller but
          slower to encode.
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
          Re-encodes every image in the media library using the current format
          and LQIP settings.
        </p>

        {!capsLoading && !canReprocess ? (
          <>
            <Button variant="outline" disabled>
              Reprocess all images
            </Button>
            <p className="text-xs text-muted-foreground">
              Image reprocessing runs in local or self-hosted mode. This site is
              served from the edge — run reprocess from your local Setu or your
              self-hosted server.
            </p>
          </>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={reprocessing}>
                Reprocess all images
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reprocess all images?</AlertDialogTitle>
                <AlertDialogDescription>
                  Re-encodes every image with the current format/LQIP settings.
                  This is heavy — especially AVIF — and is best run locally, not
                  on a deployed site.
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

        {/* Progress display while reprocessing */}
        {reprocessing && reprocessProgress !== null && (
          <div className="space-y-1.5 pt-1">
            <Progress value={progressValue} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {reprocessProgress.processed} of {reprocessProgress.total} images
            </p>
          </div>
        )}

        {showUploadsNote && (
          <p className="text-xs text-muted-foreground">
            Uploads won't generate variants (WebP/AVIF/LQIP) in this deployment
            — image processing and writable media storage are not available on
            the edge.
          </p>
        )}
      </div>
    </div>
  )
}
