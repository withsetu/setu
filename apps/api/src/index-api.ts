import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { createAuthz, DEFAULT_ROLES } from '@setu/core'
import type {
  Action,
  Actor,
  IndexQuery,
  IndexService,
  MediaIndexQuery,
  MediaIndexService
} from '@setu/core'
import { authMiddleware } from './auth/middleware'
import { apiOnError } from './errors'
import type { ResolveActor } from './auth/resolve-actor'

const authz = createAuthz(DEFAULT_ROLES)

/** Capability gate: 403 when the (already-authenticated) actor lacks `action`.
 *  Pairs with `authMiddleware` — the forms.ts pattern. */
function requireCan(action: Action) {
  return createMiddleware<{ Variables: { actor: Actor } }>(async (c, next) => {
    if (!authz.can(c.get('actor'), action))
      return c.json({ error: 'forbidden' }, 403)
    await next()
  })
}

/** Share ONE in-flight promise across concurrent callers: while `fn` is running
 *  every call gets the same promise; once it settles (either way) the next call
 *  starts a fresh run. server.ts wraps the index services' ensureBuilt with this
 *  so a burst of admin queries (or boot + first request) triggers a single
 *  build, and a failed build is retried rather than latched forever. */
export function latchInFlight(fn: () => Promise<void>): () => Promise<void> {
  let inflight: Promise<void> | null = null
  return () => {
    inflight ??= fn().finally(() => {
      inflight = null
    })
    return inflight
  }
}

const MAX_LIMIT = 100

// Query-string boundary schemas (docs/security-standards.md: new input → Zod).
// Out-of-range values are REJECTED (400), not clamped — a caller sending
// limit=1000 has a bug worth surfacing, and silent clamping hides it.
const pagination = {
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50)
}

const contentQuerySchema = z.object({
  collection: z.string().min(1),
  q: z.string().optional(),
  status: z.enum(['draft', 'staged', 'live', 'unpublished']).optional(),
  locale: z.string().optional(),
  tag: z.string().optional(),
  category: z.string().optional(),
  sort: z.enum(['updatedAt', 'title', 'status', 'locale']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  ...pagination
})

const facetsSchema = z.object({
  tagPrefix: z.string().default(''),
  tagLimit: z.coerce.number().int().min(1).max(200).default(50)
})

const referencedBySchema = z.object({ mediaKey: z.string().min(1) })
const byCategorySchema = z.object({ slug: z.string().min(1) })
const byTagSchema = z.object({ tag: z.string().min(1) })

const mediaQuerySchema = z.object({
  q: z.string().optional(),
  type: z
    .enum(['all', 'image', 'video', 'audio', 'document', 'other'])
    .optional(),
  sort: z.enum(['uploadedAt', 'filename', 'bytes']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  ...pagination
})

export interface IndexApiDeps {
  resolveActor: ResolveActor
  /** Server-side content index service. Pass `ensureBuilt` already wrapped in
   *  `latchInFlight` so route bursts, boot warm-up and post-commit refreshes
   *  all share one build. */
  index: Pick<
    IndexService,
    | 'ensureBuilt'
    | 'query'
    | 'stats'
    | 'distinctTags'
    | 'distinctLocales'
    | 'categoryCounts'
    | 'tagCounts'
    | 'referencedBy'
    | 'entriesByCategory'
    | 'entriesByTag'
  >
  media: Pick<MediaIndexService, 'ensureBuilt' | 'query'>
  /** Force a re-derivation of deploy-derived lifecycle (staged → live flips).
   *  A deploy that does not move git HEAD is invisible to `ensureBuilt` (its
   *  sha-compare finds indexedSha === HEAD and skips the walk), so the admin
   *  posts /api/index/refresh after its deploy status changes. server.ts passes
   *  refreshDeployInfo + reindexAfterDeploy, wrapped in latchInFlight. */
  refresh: () => Promise<void>
}

/** Server-authoritative content/media index routes (#464, Increment A).
 *
 *  Read-only control plane under /api/index. Content reads are gated on
 *  `content.view`, media reads on `media.view` — server-side enforcement,
 *  fail-closed (no session → 401 via authMiddleware; unknown role already
 *  resolves to a null actor upstream). Every route awaits ensureBuilt() first:
 *  after the initial build that is a cheap HEAD/version compare, and an
 *  out-of-band commit is imported incrementally before answering.
 *
 *  CORS/origin policy is owned centrally by server.ts (see app.ts's comment on
 *  createGitApi) — this factory sets none of its own. */
export function createIndexApi(deps: IndexApiDeps) {
  const app = new Hono<{ Variables: { actor: Actor } }>()
  const auth = authMiddleware(deps.resolveActor)
  const canViewContent = requireCan('content.view')
  const canViewMedia = requireCan('media.view')

  app.get('/api/index/query', auth, canViewContent, async (c) => {
    const parsed = contentQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'invalid' }, 400)
    const p = parsed.data
    const q: IndexQuery = {
      collection: p.collection,
      offset: p.offset,
      limit: p.limit,
      ...(p.q !== undefined ? { q: p.q } : {}),
      ...(p.status !== undefined ? { status: p.status } : {}),
      ...(p.locale !== undefined ? { locale: p.locale } : {}),
      ...(p.tag !== undefined ? { tag: p.tag } : {}),
      ...(p.category !== undefined ? { category: p.category } : {}),
      ...(p.sort !== undefined
        ? { sort: { key: p.sort, dir: p.dir ?? 'desc' } }
        : {})
    }
    await deps.index.ensureBuilt()
    return c.json(await deps.index.query(q))
  })

  // At-a-glance dashboard counts: per-collection lifecycle tallies in ONE call
  // over body-free rows (#587). content.view — same read surface as
  // /api/index/query, no bodies exposed. No query params: index-global by
  // design, like /facets.
  app.get('/api/index/stats', auth, canViewContent, async (c) => {
    await deps.index.ensureBuilt()
    return c.json(await deps.index.stats())
  })

  // Facets are index-global by design: the underlying port helpers
  // (distinctTags/tagCounts/…) aggregate across all collections, matching what
  // the admin's pickers consume today.
  app.get('/api/index/facets', auth, canViewContent, async (c) => {
    const parsed = facetsSchema.safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'invalid' }, 400)
    const { tagPrefix, tagLimit } = parsed.data
    await deps.index.ensureBuilt()
    const [distinctTags, distinctLocales, categoryCounts, tagCounts] =
      await Promise.all([
        deps.index.distinctTags(tagPrefix, tagLimit),
        deps.index.distinctLocales(),
        deps.index.categoryCounts(),
        deps.index.tagCounts()
      ])
    return c.json({ distinctTags, distinctLocales, categoryCounts, tagCounts })
  })

  // Entries whose live content references a media key — feeds the delete
  // confirmation's "Used in N post(s)" note. content.view: it exposes entry
  // titles/refs, nothing beyond what /api/index/query already serves.
  app.get('/api/index/referenced-by', auth, canViewContent, async (c) => {
    const parsed = referencedBySchema.safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'invalid' }, 400)
    await deps.index.ensureBuilt()
    return c.json(await deps.index.referencedBy(parsed.data.mediaKey))
  })

  // Refs for taxonomy bulk operations (category delete, tag rename/remove).
  // Read-only ref lists — the writes they feed go through the git routes, which
  // enforce their own (stronger) write actions.
  app.get('/api/index/entries-by-category', auth, canViewContent, async (c) => {
    const parsed = byCategorySchema.safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'invalid' }, 400)
    await deps.index.ensureBuilt()
    return c.json(await deps.index.entriesByCategory(parsed.data.slug))
  })

  app.get('/api/index/entries-by-tag', auth, canViewContent, async (c) => {
    const parsed = byTagSchema.safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'invalid' }, 400)
    await deps.index.ensureBuilt()
    return c.json(await deps.index.entriesByTag(parsed.data.tag))
  })

  // POST because it mutates server state — but only DERIVED state (index rows
  // re-derived from Git + deploy truth the server already holds; no content is
  // touched). Any actor allowed to read the index may ask for it to be brought
  // current, so `content.view` is the honest gate — forcing a re-derivation
  // grants nothing a reader doesn't already see eventually.
  app.post('/api/index/refresh', auth, canViewContent, async (c) => {
    await deps.refresh()
    return c.json({ ok: true })
  })

  app.get('/api/index/media/query', auth, canViewMedia, async (c) => {
    const parsed = mediaQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'invalid' }, 400)
    const p = parsed.data
    const q: MediaIndexQuery = {
      offset: p.offset,
      limit: p.limit,
      ...(p.q !== undefined ? { q: p.q } : {}),
      ...(p.type !== undefined ? { type: p.type } : {}),
      ...(p.sort !== undefined
        ? { sort: { key: p.sort, dir: p.dir ?? 'desc' } }
        : {})
    }
    await deps.media.ensureBuilt()
    return c.json(await deps.media.query(q))
  })

  app.onError(apiOnError({ scope: 'index' })) // #291: prod-generic, never err.message
  return app
}
