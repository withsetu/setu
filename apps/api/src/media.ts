import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type { Actor, StoragePort } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import type { ResolveActor } from './auth/resolve-actor'

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

/** content-type → file extension. Its keyset IS the default allowlist. */
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

export const DEFAULT_ALLOWED: Set<string> = new Set(Object.keys(EXT_BY_TYPE))

export interface UploadLimits {
  maxBytes: number
  allowedContentTypes: Set<string>
}
export interface UploadApiOptions {
  storage: StoragePort
  resolveActor: ResolveActor
  limits?: Partial<UploadLimits>
}

const authz = createAuthz(DEFAULT_ROLES)

export function createUploadApi(opts: UploadApiOptions): Hono {
  const maxBytes = opts.limits?.maxBytes ?? DEFAULT_MAX_BYTES
  const allowed = opts.limits?.allowedContentTypes ?? DEFAULT_ALLOWED
  const { storage } = opts

  const app = new Hono<{ Variables: { actor: Actor } }>()
  app.use('*', cors())

  app.post('/media', authMiddleware(opts.resolveActor), async (c) => {
    if (!authz.can(c.get('actor'), 'content.create')) return c.json({ error: 'forbidden' }, 403)

    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'no file' }, 400)

    if (file.size > maxBytes) return c.json({ error: 'file too large' }, 413)
    if (!allowed.has(file.type)) return c.json({ error: `unsupported type: ${file.type}` }, 415)

    const id = crypto.randomUUID()
    const ext = EXT_BY_TYPE[file.type]
    const key = `media/${id}/original.${ext}`
    const bytes = new Uint8Array(await file.arrayBuffer())
    await storage.put(key, bytes, { contentType: file.type })

    return c.json(
      { id, key, url: storage.url(key), contentType: file.type, size: file.size, filename: file.name },
      201,
    )
  })

  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500))
  return app
}
