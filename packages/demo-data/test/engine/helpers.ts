/** Shared fakes for the engine integration tests (#512): a synthetic pack, a
 *  no-network fetch, a stub ImagePort, and an in-memory UserStore — plus a
 *  REAL temp git repo (the engine's git seam is exercised through the actual
 *  @setu/git-local adapter) and the real disk StoragePort. */
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GeneratedVariant, ImagePort, VariantSpec } from '@setu/core'
import type {
  ContentPack,
  PackDataset,
  PackLoadOptions,
  PackPost
} from '../../src/contract'
import type { SeedRole, UserStore } from '../../src/engine/types'

// ---------- synthetic pack ----------

export interface FakePostSpec {
  id: string
  title: string
  date?: string
  categories?: string[]
  tags?: string[]
  withImage?: boolean
}

export function makePost(spec: FakePostSpec): PackPost {
  const withImage = spec.withImage ?? true
  return {
    id: spec.id,
    title: spec.title,
    body: `A synthetic body for ${spec.title}.\n\n---\n\nSource: test fixture ${spec.id}.`,
    excerpt: `Excerpt for ${spec.title}.`,
    date: spec.date ?? '1906-01-01T00:00:00.000Z',
    sourceAttribution: 'Fixture Artist',
    terms: {
      categories: spec.categories ?? ['Prints and Drawings'],
      tags: spec.tags ?? ['Etching', 'paper (fiber product)']
    },
    ...(withImage
      ? {
          image: {
            license: 'CC0 (synthetic)',
            maxWidth: 4000,
            maxHeight: 3000,
            urlForWidth: (width: number) =>
              `https://img.demo.test/${spec.id}/${Math.round(width)}.jpg`
          }
        }
      : {})
  }
}

/** A deterministic in-memory ContentPack over the given posts. */
export function makePack(posts: PackPost[]): ContentPack {
  return {
    meta: {
      id: 'fake',
      name: 'Fake Pack',
      sourceUrl: 'https://example.test/fixture',
      license: 'CC0 (synthetic fixture)'
    },
    load(options: PackLoadOptions = {}): PackDataset {
      let loaded = 0
      async function* stream(): AsyncGenerator<PackPost> {
        for (const post of posts) {
          options.signal?.throwIfAborted()
          if (options.limit !== undefined && loaded >= options.limit) return
          loaded++
          yield post
        }
      }
      return {
        posts: stream(),
        stats: () => ({ scanned: loaded, loaded, skipped: {} })
      }
    }
  }
}

// ---------- fakes for the heavy seams ----------

/** Tiny valid-enough JPEG payload (magic bytes only — the stub ImagePort never
 *  parses it). */
export const FAKE_JPEG: Uint8Array = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9
])

export interface FakeFetch {
  fetchImpl: typeof fetch
  calls: string[]
  /** user-agent header of each request, in call order. */
  userAgents: Array<string | undefined>
}

/** An https-only fake fetch: records every URL; `failFor(url)` → HTTP 500. */
export function makeFakeFetch(failFor?: (url: string) => boolean): FakeFetch {
  const calls: string[] = []
  const userAgents: Array<string | undefined> = []
  const fetchImpl = ((
    input: Parameters<typeof fetch>[0],
    init?: RequestInit
  ) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    calls.push(url)
    userAgents.push(new Headers(init?.headers).get('user-agent') ?? undefined)
    if (failFor?.(url)) {
      return Promise.resolve(
        new Response('boom', {
          status: 500,
          headers: { 'content-type': 'text/plain' }
        })
      )
    }
    return Promise.resolve(
      new Response(FAKE_JPEG.slice().buffer, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' }
      })
    )
  }) as typeof fetch
  return { fetchImpl, calls, userAgents }
}

/** Stub ImagePort: fixed 800×600 metadata, one tiny body per requested spec. */
export function makeStubImage(): ImagePort {
  return {
    metadata: () =>
      Promise.resolve({ width: 800, height: 600, format: 'jpeg' }),
    generate: (_source: Uint8Array, specs: VariantSpec[]) =>
      Promise.resolve(
        specs.map((spec): GeneratedVariant => ({
          name: spec.name,
          width: spec.width,
          height: Math.round((spec.width * 3) / 4),
          format: spec.format,
          contentType: `image/${spec.format}`,
          body: new Uint8Array([1, 2, 3])
        }))
      ),
    placeholder: () => Promise.resolve('data:image/webp;base64,AA==')
  }
}

export interface FakeUserStore extends UserStore {
  rows: Map<string, { id: string; role: SeedRole; password: string }>
}

export function makeFakeUserStore(): FakeUserStore {
  const rows = new Map<
    string,
    { id: string; role: SeedRole; password: string }
  >()
  let nextId = 1
  return {
    rows,
    findByEmail: (email) => {
      const row = rows.get(email)
      return Promise.resolve(row ? { id: row.id } : null)
    },
    create: (user) => {
      const id = `u${nextId++}`
      rows.set(user.email, { id, role: user.role, password: user.password })
      return Promise.resolve({ id })
    },
    deleteById: (id) => {
      for (const [email, row] of rows)
        if (row.id === id) {
          rows.delete(email)
          return Promise.resolve()
        }
      return Promise.reject(new Error(`no user ${id}`))
    }
  }
}

// ---------- real temp git sandbox ----------

export function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@setu.local', ...args],
    { cwd, encoding: 'utf8' }
  )
}

/** A temp sandbox repo shaped like `.content-sandbox/dev`: one hand-made post
 *  and one pre-existing category, committed. */
export async function makeSandbox(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'demo-seed-sandbox-'))
  await mkdir(path.join(dir, 'content', 'post', 'en'), { recursive: true })
  await mkdir(path.join(dir, 'taxonomy'), { recursive: true })
  await writeFile(
    path.join(dir, 'content', 'post', 'en', 'handmade.mdoc'),
    '---\ncid: 9b2f0c6e-1111-4222-8333-444455556666\ntitle: Handmade\ndate: 2026-01-01T00:00:00.000Z\ncategories:\n  - recipes\n---\n\nA hand-made post that seeding must never touch.\n',
    'utf8'
  )
  await writeFile(
    path.join(dir, 'taxonomy', 'categories.yaml'),
    '- slug: recipes\n  name: Recipes\n  parent: null\n',
    'utf8'
  )
  git(dir, ['init', '-q'])
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'seed sandbox'])
  return dir
}

export const makeMediaDir = (): Promise<string> =>
  mkdtemp(path.join(tmpdir(), 'demo-seed-media-'))
