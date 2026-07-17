/** Seed-engine types (#512, epic #509).
 *
 *  The engine turns a ContentPack into a populated dev site: users per role,
 *  posts committed straight to Git in chunks, categories registered once,
 *  featured images downloaded/ingested in a resumable bounded batch — plus a
 *  seed manifest that makes everything removable (#513's primitive).
 *
 *  Node-only dev tooling by design (like the rest of @setu/demo-data): it
 *  drives local adapters (git-local, storage-local, image-sharp, db-sqlite)
 *  and MUST only ever target a dev content sandbox, never canonical content. */
import type {
  GitPort,
  ImagePort,
  StoragePort,
  SafeFetchOptions
} from '@setu/core'
import type { ContentPack } from '../contract'

/** The four Setu roles (admin > maintainer > editor > author). All of them are
 *  author-capable for seeding purposes — every seeded user owns some posts. */
export const SEED_ROLES = ['admin', 'maintainer', 'editor', 'author'] as const
export type SeedRole = (typeof SEED_ROLES)[number]

/** Persistence seam for demo users. The default implementation wraps
 *  better-auth's internalAdapter over the sandbox's own sqlite file (the exact
 *  path `e2e/lib/seed-users.ts` and apps/api's admin-invite use); tests inject
 *  an in-memory fake. */
export interface UserStore {
  findByEmail(email: string): Promise<{ id: string } | null>
  create(user: {
    email: string
    name: string
    role: SeedRole
    password: string
  }): Promise<{ id: string }>
  /** Hard-delete a user (sessions + accounts + row). May reject (e.g. the
   *  last-admin guard) — callers count and report, never crash. */
  deleteById(id: string): Promise<void>
}

/** Injectable seams. Everything defaults to the real local adapters; tests
 *  swap in fakes so the whole engine runs without network, sharp, or sqlite. */
export interface SeedDeps {
  git?: GitPort
  storage?: StoragePort
  image?: ImagePort
  users?: UserStore
  /** Passed through to core `safeFetch` for image downloads (tests inject
   *  `fetchImpl`; the default adds a Node DNS `resolveHost`). */
  fetch?: Pick<SafeFetchOptions, 'fetchImpl' | 'resolveHost'>
  /** Probe for a live dev api against this sandbox (cross-process git safety
   *  warning). Default: TCP connect to SETU_API_PORT ?? 4444. */
  probeApiLive?: () => Promise<boolean>
  now?: () => number
}

export interface SeedOptions {
  /** The dev content sandbox (a git repo, e.g. `.content-sandbox/dev`) — the
   *  engine refuses to run against a directory that is not one. */
  sandboxDir: string
  /** Media storage root (e.g. `.setu/uploads`). */
  mediaDir: string
  pack: ContentPack
  /** Posts to seed (the pack may yield fewer; the summary reports reality). */
  posts: number
  /** Users to create per role. At least one user total is required. */
  users: Partial<Record<SeedRole, number>>
  /** Target collection/locale. Defaults: `post` / `en`. */
  collection?: string
  locale?: string
  /** Fraction of posts seeded as drafts (`published: false` — the repo's ONLY
   *  draft signal). Default 0.1. */
  draftFraction?: number
  /** Source-width mix for featured images; each post cycles through this list
   *  deterministically. Default [400, 843, 843, 1686] (843 = AIC's own most
   *  common width, so it is weighted double). */
  imageWidthMix?: readonly number[]
  /** Only the first N posts get featured images (caps download volume on big
   *  seeds). Default: all posts. */
  limitImages?: number
  /** Recorded in the run identity so a strict-tier checkpoint is never resumed
   *  by a relaxed-tier run. The pack itself is built by the caller (e.g. the
   *  CLI's `--relax-text` constructs `createAicPack({ textTier: 'relaxed' })`). */
  relaxText?: boolean
  /** Concurrent image downloads. Default 4. */
  concurrency?: number
  onProgress?: (progress: SeedProgress) => void
  /** Honored between images and between commit chunks; state is flushed before
   *  the abort surfaces, so a re-run resumes instead of redoing work. */
  signal?: AbortSignal
  deps?: SeedDeps
}

export type SeedProgress =
  | { phase: 'warning'; message: string }
  | { phase: 'users'; done: number; total: number }
  | { phase: 'plan'; done: number; total: number }
  | { phase: 'categories'; added: number }
  | { phase: 'images'; done: number; failed: number; total: number }
  | { phase: 'posts'; done: number; total: number }

export interface SeedUserSummary {
  email: string
  role: SeedRole
  /** The generated password — returned ONCE here, never logged by the engine.
   *  `null` when the user already existed (their password is unchanged). */
  password: string | null
}

export interface SeedSummary {
  users: SeedUserSummary[]
  /** Posts written into the sandbox (committed, including net-empty re-runs). */
  posts: number
  /** Featured images successfully downloaded + ingested in THIS run. */
  images: number
  /** Image items skipped because a prior run already completed them. */
  imagesReused: number
  /** Image downloads that failed this run (counted, not fatal). */
  imageFailures: number
  /** Git commits made by this run (post chunks + the categories commit). */
  commits: number
  /** Pack-reported skip reasons observed while streaming. */
  skipped: Record<string, number>
  durationMs: number
}

export interface RemoveOptions {
  sandboxDir: string
  mediaDir: string
  onProgress?: (progress: SeedProgress) => void
  /** Honored between post-chunk commits and between media/user deletions.
   *  The manifest is only cleared at the very end, so an aborted removal
   *  re-runs to completion instead of stranding seeded content (#513). */
  signal?: AbortSignal
  deps?: SeedDeps
}

export interface RemoveSummary {
  /** Seeded posts deleted from the sandbox repo. */
  posts: number
  /** Media objects (original + variants + sidecars) removed, counted by key. */
  media: number
  /** Demo users deleted. */
  users: number
  /** Users that could not be deleted (e.g. last-admin guard) — reported, not fatal. */
  userFailures: number
  /** Manifest user entries skipped because they don't match the demo-email
   *  pattern — removal never deletes accounts seeding couldn't have created. */
  usersSkipped: number
  /** Seed-added categories removed (only those no remaining post references). */
  categories: number
  durationMs: number
}
