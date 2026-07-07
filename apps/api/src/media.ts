import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  createAuthz,
  DEFAULT_ROLES,
  ingestImage,
  mediaSlug,
  mediaKeyOf,
  originalKey,
  manifestKey,
  mediaRecordKey
} from '@setu/core'
import type {
  Actor,
  ImageFormat,
  ImagePort,
  MediaManifest,
  MediaRecord,
  MediaSettings,
  ReprocessJobStore,
  StoragePort
} from '@setu/core'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor } from './auth/resolve-actor'

function formatsFor(setting: 'webp' | 'avif' | 'both'): ImageFormat[] {
  return setting === 'both' ? ['webp', 'avif'] : [setting]
}

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

/** content-type → file extension. Its keyset IS the default allowlist. */
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/webm': 'webm'
}

export const DEFAULT_ALLOWED: Set<string> = new Set(Object.keys(EXT_BY_TYPE))

/** Raster image types we generate variants for (gif excluded — animated). */
const GENERATABLE: Set<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif'
])

const DEFAULT_WIDTHS: number[] = [400, 800, 1200, 1600]
const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  imageFormat: 'webp',
  imageLqip: false
}

export interface UploadLimits {
  maxBytes: number
  allowedContentTypes: Set<string>
}
export interface UploadApiOptions {
  storage: StoragePort
  resolveActor: ResolveActor
  limits?: Partial<UploadLimits>
  image?: ImagePort
  widths?: number[]
  /** Current Media settings. Pass a getter (not a snapshot) so uploads and reprocess pick up
   *  setting changes made after boot — the server's settings.json is read at request time. */
  mediaSettings?: MediaSettings | (() => MediaSettings)
  /** Async reprocess job store + runner. When absent, the /api/media/reprocess routes return 409. */
  reprocess?: { store: ReprocessJobStore; run: (jobId: string) => void }
}

const authz = createAuthz(DEFAULT_ROLES)

export function createUploadApi(opts: UploadApiOptions) {
  const maxBytes = opts.limits?.maxBytes ?? DEFAULT_MAX_BYTES
  const allowed = opts.limits?.allowedContentTypes ?? DEFAULT_ALLOWED
  const { storage } = opts
  // Resolve per request so a settings change (Media format/LQIP) takes effect without an api restart.
  const resolveMedia = (): MediaSettings => {
    const m = opts.mediaSettings
    return (typeof m === 'function' ? m() : m) ?? DEFAULT_MEDIA_SETTINGS
  }
  const widths = opts.widths ?? DEFAULT_WIDTHS

  const app = new Hono<{ Variables: { actor: Actor } }>()
  app.use('*', cors())

  app.post('/media', authMiddleware(opts.resolveActor), async (c) => {
    if (!authz.can(c.get('actor'), 'content.create'))
      return c.json({ error: 'forbidden' }, 403)

    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'no file' }, 400)

    if (file.size > maxBytes) return c.json({ error: 'file too large' }, 413)
    if (!allowed.has(file.type))
      return c.json({ error: `unsupported type: ${file.type}` }, 415)

    const ext = EXT_BY_TYPE[file.type]
    if (ext === undefined)
      return c.json({ error: `unsupported type: ${file.type}` }, 415)
    const now = new Date()
    const yyyy = now.getUTCFullYear()
    const mm = now.getUTCMonth() + 1
    const slug = mediaSlug(file.name)
    let mediaKey = mediaKeyOf(yyyy, mm, slug)
    for (
      let n = 2;
      (await storage.exists(originalKey(mediaKey, ext))) ||
      (await storage.exists(manifestKey(mediaKey)));
      n += 1
    ) {
      if (n > 1000) throw new Error(`media key collision overflow for ${slug}`)
      mediaKey = mediaKeyOf(yyyy, mm, `${slug}-${n}`)
    }
    const key = originalKey(mediaKey, ext)
    const bytes = new Uint8Array(await file.arrayBuffer())
    await storage.put(key, bytes, { contentType: file.type })

    let manifest: MediaManifest | undefined
    if (opts.image && GENERATABLE.has(file.type)) {
      const media = resolveMedia()
      try {
        manifest = await ingestImage(
          { image: opts.image, storage },
          {
            mediaKey,
            bytes,
            originalKey: key,
            formats: formatsFor(media.imageFormat),
            widths,
            lqip: media.imageLqip
          }
        )
      } catch (err) {
        console.warn(
          `media ingest failed for ${mediaKey}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }

    const isImage = file.type.startsWith('image/')
    const smallest = manifest?.variants
      .slice()
      .sort((a, b) => a.width - b.width)[0]
    const record: MediaRecord = {
      mediaKey,
      key,
      thumbKey: smallest ? smallest.key : null,
      filename: file.name,
      contentType: file.type,
      isImage,
      width: manifest ? manifest.original.width : null,
      height: manifest ? manifest.original.height : null,
      bytes: file.size,
      uploadedAt: Date.now()
    }
    await storage.put(
      mediaRecordKey(mediaKey),
      new TextEncoder().encode(JSON.stringify(record)),
      {
        contentType: 'application/json'
      }
    )

    return c.json(
      {
        id: mediaKey,
        key,
        url: storage.url(key),
        contentType: file.type,
        size: file.size,
        filename: file.name,
        record,
        ...(manifest ? { manifest } : {})
      },
      201
    )
  })

  app.post(
    '/api/media/reprocess',
    authMiddleware(opts.resolveActor),
    async (c) => {
      if (!authz.can(c.get('actor'), 'content.create'))
        return c.json({ error: 'forbidden' }, 403)
      if (!opts.image || !opts.reprocess)
        return c.json({ error: 'reprocess unavailable in this mode' }, 409)
      const running = opts.reprocess.store.active()
      if (running)
        return c.json(
          {
            jobId: running.id,
            status: running.status,
            total: running.total,
            processed: running.processed
          },
          202
        )
      const all = await storage.list()
      const keys = all.filter((k) => k.endsWith('.manifest.json'))
      const job = opts.reprocess.store.create(keys, Date.now())
      opts.reprocess.run(job.id)
      return c.json(
        {
          jobId: job.id,
          status: job.status,
          total: job.total,
          processed: job.processed
        },
        202
      )
    }
  )

  app.get('/api/media/reprocess/status', (c) => {
    const store = opts.reprocess?.store
    const job = store?.active() ?? store?.latest()
    if (!job) return c.json({ status: 'idle' })
    return c.json({
      status: job.status,
      processed: job.processed,
      total: job.total,
      ...(job.error ? { error: job.error } : {})
    })
  })

  app.get('/media/_index', async (c) => {
    const keys = await storage.list()
    const records: MediaRecord[] = []
    for (const k of keys) {
      if (!k.endsWith('.media.json')) continue
      const obj = await storage.get(k)
      if (!obj) continue
      try {
        records.push(
          JSON.parse(new TextDecoder().decode(obj.body)) as MediaRecord
        )
      } catch {
        /* skip corrupt */
      }
    }
    return c.json({ records })
  })

  app.delete('/media/*', authMiddleware(opts.resolveActor), async (c) => {
    if (!authz.can(c.get('actor'), 'content.create'))
      return c.json({ error: 'forbidden' }, 403)
    const mediaKey = decodeURIComponent(c.req.path.slice('/media/'.length))
    if (mediaKey.split('/').some((seg) => seg === '..' || seg === ''))
      return c.json({ error: 'not found' }, 404)

    const manRaw = await storage.get(manifestKey(mediaKey))
    if (manRaw) {
      const man = JSON.parse(
        new TextDecoder().decode(manRaw.body)
      ) as MediaManifest
      await storage.delete(man.original.key)
      for (const v of man.variants) await storage.delete(v.key)
      await storage.delete(manifestKey(mediaKey))
    }
    const recRaw = await storage.get(mediaRecordKey(mediaKey))
    if (recRaw) {
      const rec = JSON.parse(
        new TextDecoder().decode(recRaw.body)
      ) as MediaRecord
      await storage.delete(rec.key) // original (covers non-images with no manifest)
      await storage.delete(mediaRecordKey(mediaKey))
    }
    return c.json({ ok: true })
  })

  app.get('/media/*', async (c) => {
    const key = decodeURIComponent(c.req.path.slice('/media/'.length))
    if (key.split('/').some((seg) => seg === '..' || seg === ''))
      return c.json({ error: 'not found' }, 404)
    const obj = await storage.get(key)
    if (!obj) return c.json({ error: 'not found' }, 404)
    const headers: Record<string, string> = { 'Content-Type': obj.contentType }
    if (!obj.contentType.startsWith('image/'))
      headers['Content-Disposition'] = 'attachment'
    // `obj.body` is a Uint8Array — a valid Response body at runtime (Node/undici).
    // The cast satisfies lib.dom's stricter `BodyInit` (which wants the ArrayBuffer-
    // specific `Uint8Array<ArrayBuffer>`); lib.dom leaks into this program via vitest's
    // types in the test files. Zero-cost — copying the buffer here would tax every media GET.
    return new Response(obj.body as BodyInit, { status: 200, headers })
  })

  app.onError((err, c) =>
    c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  )
  return app
}
