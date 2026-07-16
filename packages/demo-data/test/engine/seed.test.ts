/** Integration tests for seedDemoData/removeSeeded (#512): real temp git repo
 *  (actual @setu/git-local adapter), real disk storage, NO network (injected
 *  fetch), NO sharp (stub ImagePort), NO sqlite (in-memory user store). */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalGitAdapter } from '@setu/git-local'
import { createLocalStorage } from '@setu/storage-local'
import { parseMdoc, isCid } from '@setu/core'
import { seedDemoData, removeSeeded, IMAGE_USER_AGENT } from '../../src/engine'
import type { SeedDeps, SeedOptions } from '../../src/engine'
import { loadManifest, loadCheckpoint, runKeyOf } from '../../src/engine'
import {
  git,
  makeFakeFetch,
  makeFakeUserStore,
  makeMediaDir,
  makePack,
  makePost,
  makeSandbox,
  makeStubImage
} from './helpers'
import type { FakeFetch, FakeUserStore } from './helpers'

interface Rig {
  sandbox: string
  media: string
  deps: SeedDeps
  fetch: FakeFetch
  users: FakeUserStore
  options: SeedOptions
}

async function makeRig(
  postCount: number,
  failFor?: (url: string) => boolean
): Promise<Rig> {
  const sandbox = await makeSandbox()
  const media = await makeMediaDir()
  const fetch = makeFakeFetch(failFor)
  const users = makeFakeUserStore()
  const deps: SeedDeps = {
    git: createLocalGitAdapter({ dir: sandbox }),
    storage: createLocalStorage({ dir: media, baseUrl: '/media' }),
    image: makeStubImage(),
    users,
    fetch: { fetchImpl: fetch.fetchImpl },
    probeApiLive: () => Promise.resolve(false),
    now: () => 1752600000000
  }
  const pack = makePack(
    Array.from({ length: 16 }, (_, i) =>
      makePost({
        id: String(i + 1),
        title: `Artwork ${i + 1}`,
        date: `19${String(10 + i)}-01-01T00:00:00.000Z`
      })
    )
  )
  return {
    sandbox,
    media,
    deps,
    fetch,
    users,
    options: {
      sandboxDir: sandbox,
      mediaDir: media,
      pack,
      posts: postCount,
      users: { admin: 1, author: 2 },
      draftFraction: 0.25,
      concurrency: 2,
      deps
    }
  }
}

const postDir = (sandbox: string): string =>
  path.join(sandbox, 'content', 'post', 'en')

describe('seedDemoData', () => {
  it('seeds users, posts, categories, and media — everything on disk and in git', async () => {
    const rig = await makeRig(12)
    const summary = await seedDemoData(rig.options)

    // Summary shape.
    expect(summary.posts).toBe(12)
    expect(summary.images).toBe(12)
    expect(summary.imageFailures).toBe(0)
    // 3 owner chunks + 1 categories commit.
    expect(summary.commits).toBe(4)
    expect(summary.users).toHaveLength(3)
    for (const user of summary.users) {
      expect(user.password).toBeTruthy()
      expect(rig.users.rows.get(user.email)?.password).toBe(user.password)
    }

    // Posts on disk: 12 seeded + the hand-made one, untouched.
    const files = await readdir(postDir(rig.sandbox))
    expect(files).toHaveLength(13)
    expect(files).toContain('handmade.mdoc')
    expect(files).toContain('artwork-1.mdoc')

    // Frontmatter of a seeded post.
    const raw = await readFile(
      path.join(postDir(rig.sandbox), 'artwork-1.mdoc'),
      'utf8'
    )
    const { frontmatter, body } = parseMdoc(raw)
    expect(isCid(frontmatter['cid'])).toBe(true)
    expect(frontmatter['title']).toBe('Artwork 1')
    expect(frontmatter['date']).toBe('1910-01-01T00:00:00.000Z')
    expect(frontmatter['categories']).toEqual(['prints-and-drawings'])
    expect(frontmatter['tags']).toEqual(['etching', 'paper-fiber-product'])
    expect(frontmatter['featuredImage']).toBe('/media/1910/01/artwork-1.jpg')
    expect(typeof frontmatter['author']).toBe('string')
    expect(body).toContain('A synthetic body for Artwork 1.')

    // Draft realism: 0.25 × 12 = 3 drafts, published: false the only signal.
    let drafts = 0
    for (const file of files) {
      if (file === 'handmade.mdoc') continue
      const fm = parseMdoc(
        await readFile(path.join(postDir(rig.sandbox), file), 'utf8')
      ).frontmatter
      expect('status' in fm).toBe(false)
      if (fm['published'] === false) drafts++
    }
    expect(drafts).toBe(3)

    // Categories registered once, existing entry preserved.
    const registry = await readFile(
      path.join(rig.sandbox, 'taxonomy', 'categories.yaml'),
      'utf8'
    )
    expect(registry).toContain('recipes')
    expect(registry).toContain('prints-and-drawings')

    // Git log: chunk commits carry the OWNING user's identity; categories the
    // neutral demo-data identity; one commit per owner chunk.
    const log = git(rig.sandbox, ['log', '--format=%ae|%s'])
    expect(log).toContain('demo-admin-1@demo.setu.test|demo-data: seed')
    expect(log).toContain('demo-author-1@demo.setu.test|demo-data: seed')
    expect(log).toContain('demo-author-2@demo.setu.test|demo-data: seed')
    expect(log).toContain('demo-data@setu.local|demo-data: register')

    // Media on disk: original, webp ladder (400 + source cap 800), manifest,
    // and the .media.json record the media library lists.
    const mediaFiles = await readdir(path.join(rig.media, '1910', '01'))
    expect(mediaFiles).toContain('artwork-1.jpg')
    expect(mediaFiles).toContain('artwork-1-400w.webp')
    expect(mediaFiles).toContain('artwork-1-800w.webp')
    expect(mediaFiles).toContain('artwork-1.manifest.json')
    expect(mediaFiles).toContain('artwork-1.media.json')
    const record = JSON.parse(
      await readFile(
        path.join(rig.media, '1910', '01', 'artwork-1.media.json'),
        'utf8'
      )
    ) as Record<string, unknown>
    expect(record['mediaKey']).toBe('1910/01/artwork-1')
    expect(record['thumbKey']).toBe('1910/01/artwork-1-400w.webp')
    expect(record['isImage']).toBe(true)

    // Manifest (the #513 removal primitive) + checkpoint.
    const manifest = await loadManifest(rig.sandbox)
    expect(manifest.posts).toHaveLength(12)
    expect(manifest.mediaKeys).toHaveLength(12)
    expect(manifest.users).toHaveLength(3)
    expect(manifest.categories).toEqual(['prints-and-drawings'])
    const runKey = runKeyOf({
      packId: 'fake',
      posts: 12,
      users: { admin: 1, author: 2 },
      collection: 'post',
      locale: 'en',
      draftFraction: 0.25,
      imageWidthMix: [400, 843, 843, 1686],
      limitImages: null,
      relaxText: false
    })
    const checkpoint = await loadCheckpoint(rig.sandbox, runKey)
    expect(Object.keys(checkpoint.images)).toHaveLength(12)
    expect(checkpoint.chunksDone).toHaveLength(3)
  })

  it('cycles the image width mix deterministically', async () => {
    const rig = await makeRig(4)
    await seedDemoData({ ...rig.options, imageWidthMix: [400, 843, 1686] })
    expect(rig.fetch.calls).toEqual(
      expect.arrayContaining([
        'https://img.demo.test/1/400.jpg',
        'https://img.demo.test/2/843.jpg',
        'https://img.demo.test/3/1686.jpg',
        'https://img.demo.test/4/400.jpg'
      ])
    )
  })

  it('clamps the requested width to the source image intrinsic width (AIC 403s over-width requests)', async () => {
    const rig = await makeRig(1)
    const narrow = makePack([
      {
        ...makePost({ id: '1', title: 'Narrow' }),
        image: {
          license: 'CC0 (synthetic)',
          maxWidth: 768,
          urlForWidth: (w: number) =>
            `https://img.demo.test/narrow/${Math.round(w)}.jpg`
        }
      }
    ])
    await seedDemoData({
      ...rig.options,
      pack: narrow,
      posts: 1,
      imageWidthMix: [1686]
    })
    expect(rig.fetch.calls).toEqual(['https://img.demo.test/narrow/768.jpg'])
  })

  it('identifies itself with a descriptive User-Agent on every image download (AIC 403s the default UA)', async () => {
    const rig = await makeRig(2)
    await seedDemoData(rig.options)
    expect(rig.fetch.userAgents).toHaveLength(2)
    for (const ua of rig.fetch.userAgents) expect(ua).toBe(IMAGE_USER_AGENT)
  })

  it('caps featured images at limitImages', async () => {
    const rig = await makeRig(6)
    const summary = await seedDemoData({ ...rig.options, limitImages: 2 })
    expect(summary.images).toBe(2)
    expect(rig.fetch.calls).toHaveLength(2)
    const fm = parseMdoc(
      await readFile(path.join(postDir(rig.sandbox), 'artwork-6.mdoc'), 'utf8')
    ).frontmatter
    expect('featuredImage' in fm).toBe(false)
  })

  it('counts image failures without failing the seed, and retries them on re-run — completed work is never redone', async () => {
    // Run 1: downloads for posts 7..12 fail.
    const rig = await makeRig(12, (url) => /\/(7|8|9|10|11|12)\//.test(url))
    const first = await seedDemoData(rig.options)
    expect(first.images).toBe(6)
    expect(first.imageFailures).toBe(6)
    expect(first.posts).toBe(12)
    // A failed post landed WITHOUT a featured image (no dangling reference).
    const failedBefore = parseMdoc(
      await readFile(path.join(postDir(rig.sandbox), 'artwork-7.mdoc'), 'utf8')
    ).frontmatter
    expect('featuredImage' in failedBefore).toBe(false)

    // Run 2: same options, healthy fetch that counts its calls.
    const healthy = makeFakeFetch()
    const second = await seedDemoData({
      ...rig.options,
      deps: { ...rig.deps, fetch: { fetchImpl: healthy.fetchImpl } }
    })
    // Exactly the 6 previously-failed downloads — zero rework of done items.
    expect(healthy.calls).toHaveLength(6)
    expect(healthy.calls.every((u) => /\/(7|8|9|10|11|12)\//.test(u))).toBe(
      true
    )
    expect(second.images).toBe(6)
    expect(second.imagesReused).toBe(6)
    expect(second.imageFailures).toBe(0)

    // The retried post's chunk was re-committed with its featuredImage.
    const failedAfter = parseMdoc(
      await readFile(path.join(postDir(rig.sandbox), 'artwork-7.mdoc'), 'utf8')
    ).frontmatter
    expect(failedAfter['featuredImage']).toBe('/media/1916/01/artwork-7.jpg')
  })

  it('honors an AbortSignal between items and resumes from the checkpoint', async () => {
    const rig = await makeRig(8)
    const controller = new AbortController()
    let imagesSeen = 0
    await expect(
      seedDemoData({
        ...rig.options,
        concurrency: 1,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === 'images' && ++imagesSeen === 3) controller.abort()
        }
      })
    ).rejects.toThrow()
    expect(rig.fetch.calls.length).toBeLessThan(8)

    // Resume: completed downloads are skipped; the seed finishes.
    const healthy = makeFakeFetch()
    const summary = await seedDemoData({
      ...rig.options,
      deps: { ...rig.deps, fetch: { fetchImpl: healthy.fetchImpl } }
    })
    expect(summary.posts).toBe(8)
    expect(summary.images + summary.imagesReused).toBe(8)
    expect(healthy.calls.length).toBe(8 - rig.fetch.calls.length)
  })

  it('re-running identical options is a no-op: no downloads, no new commits, byte-stable files', async () => {
    const rig = await makeRig(6)
    await seedDemoData(rig.options)
    const before = git(rig.sandbox, ['rev-parse', 'HEAD'])
    const fileBefore = await readFile(
      path.join(postDir(rig.sandbox), 'artwork-3.mdoc'),
      'utf8'
    )

    const healthy = makeFakeFetch()
    const summary = await seedDemoData({
      ...rig.options,
      deps: { ...rig.deps, fetch: { fetchImpl: healthy.fetchImpl } }
    })
    expect(healthy.calls).toHaveLength(0)
    expect(summary.commits).toBe(0)
    expect(git(rig.sandbox, ['rev-parse', 'HEAD'])).toBe(before)
    expect(
      await readFile(path.join(postDir(rig.sandbox), 'artwork-3.mdoc'), 'utf8')
    ).toBe(fileBefore)
  })

  it('a larger re-seed reuses already-seeded slugs and cids instead of duplicating', async () => {
    const rig = await makeRig(4)
    await seedDemoData(rig.options)
    const fileBefore = await readFile(
      path.join(postDir(rig.sandbox), 'artwork-2.mdoc'),
      'utf8'
    )

    await seedDemoData({ ...rig.options, posts: 8 })
    const files = await readdir(postDir(rig.sandbox))
    expect(files).toHaveLength(9) // 8 seeded + handmade — no artwork-2-2.mdoc
    expect(
      await readFile(path.join(postDir(rig.sandbox), 'artwork-2.mdoc'), 'utf8')
    ).toBe(fileBefore) // same slug, same cid — byte-stable
  })

  it('warns when a dev api appears to be running against the sandbox', async () => {
    const rig = await makeRig(2)
    const warnings: string[] = []
    await seedDemoData({
      ...rig.options,
      deps: { ...rig.deps, probeApiLive: () => Promise.resolve(true) },
      onProgress: (p) => {
        if (p.phase === 'warning') warnings.push(p.message)
      }
    })
    expect(warnings.some((w) => w.includes('single-writer'))).toBe(true)
  })

  it('refuses a sandbox that is not a git repository', async () => {
    const rig = await makeRig(2)
    await expect(
      seedDemoData({ ...rig.options, sandboxDir: await makeMediaDir() })
    ).rejects.toThrow('not a git repository')
  })
})

describe('removeSeeded', () => {
  it('removes exactly what seeding generated — posts, media, users, categories — and clears the manifest', async () => {
    const rig = await makeRig(6)
    await seedDemoData(rig.options)
    expect(rig.users.rows.size).toBe(3)

    const summary = await removeSeeded({
      sandboxDir: rig.sandbox,
      mediaDir: rig.media,
      deps: rig.deps
    })
    expect(summary.posts).toBe(6)
    expect(summary.media).toBe(6)
    expect(summary.users).toBe(3)
    expect(summary.userFailures).toBe(0)
    expect(summary.categories).toBe(1)

    // Hand-made content untouched; seeded posts gone.
    const files = await readdir(postDir(rig.sandbox))
    expect(files).toEqual(['handmade.mdoc'])
    // Pre-existing category kept; seed-added removed.
    const registry = await readFile(
      path.join(rig.sandbox, 'taxonomy', 'categories.yaml'),
      'utf8'
    )
    expect(registry).toContain('recipes')
    expect(registry).not.toContain('prints-and-drawings')
    // Media store empty again (storage-local list sees no objects).
    const storage = rig.deps.storage!
    expect(await storage.list()).toEqual([])
    // Users gone; manifest + checkpoint cleared.
    expect(rig.users.rows.size).toBe(0)
    const manifest = await loadManifest(rig.sandbox)
    expect(manifest.posts).toEqual([])
    expect(manifest.users).toEqual([])
  })

  it('keeps a seed-added category that a remaining hand-made post references', async () => {
    const rig = await makeRig(4)
    await seedDemoData(rig.options)
    // A human writes a post using the seeded category, AFTER seeding.
    await rig.deps.git!.commitFiles({
      changes: [
        {
          path: 'content/post/en/human-later.mdoc',
          content:
            '---\ntitle: Human Later\ncategories:\n  - prints-and-drawings\n---\n\nKept.\n'
        }
      ],
      message: 'human post',
      author: { name: 'Human', email: 'human@setu.local' }
    })

    const summary = await removeSeeded({
      sandboxDir: rig.sandbox,
      mediaDir: rig.media,
      deps: rig.deps
    })
    expect(summary.categories).toBe(0)
    const registry = await readFile(
      path.join(rig.sandbox, 'taxonomy', 'categories.yaml'),
      'utf8'
    )
    expect(registry).toContain('prints-and-drawings')
  })

  it('counts a user the store refuses to delete instead of crashing', async () => {
    const rig = await makeRig(2)
    await seedDemoData(rig.options)
    const stubborn = {
      ...rig.users,
      deleteById: (id: string) =>
        id === 'u1'
          ? Promise.reject(new Error('last admin'))
          : rig.users.deleteById(id)
    }
    const summary = await removeSeeded({
      sandboxDir: rig.sandbox,
      mediaDir: rig.media,
      deps: { ...rig.deps, users: stubborn }
    })
    expect(summary.users).toBe(2)
    expect(summary.userFailures).toBe(1)
  })
})
