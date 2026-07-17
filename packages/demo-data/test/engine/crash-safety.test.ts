/** Review-fix regression pins (#512): the crash-safety invariant
 *  (manifest-intent BEFORE side effects, checkpoint-completion AFTER),
 *  dataset-aware resume keys, upload-parity media-key probing, fail-closed
 *  unseed, the demo-email deletion fence, and strict CLI flag parsing. */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalGitAdapter } from '@setu/git-local'
import { createLocalStorage } from '@setu/storage-local'
import { manifestKey, parseMdoc } from '@setu/core'
import type { GitPort } from '@setu/core'
import { removeSeeded, seedDemoData } from '../../src/engine'
import type { SeedDeps, SeedOptions } from '../../src/engine'
import { loadManifest } from '../../src/engine/state'
import { createAicPack } from '../../src/aic/pack'
import { intFlag, parseSeedFlags } from '../../src/cli'
import {
  makeFakeFetch,
  makeFakeUserStore,
  makeMediaDir,
  makePack,
  makePost,
  makeSandbox,
  makeStubImage
} from './helpers'
import type { FakeFetch } from './helpers'

const PACK_POSTS = Array.from({ length: 8 }, (_, i) =>
  makePost({
    id: String(i + 1),
    title: `Artwork ${i + 1}`,
    date: `19${String(10 + i)}-01-01T00:00:00.000Z`
  })
)

interface Rig {
  sandbox: string
  media: string
  fetch: FakeFetch
  deps: SeedDeps
  options: SeedOptions
}

/** Deps are rebuildable over the same dirs so a "crashed" run can be resumed
 *  with pristine adapters, exactly like a new process would. */
async function makeRig(posts = 8): Promise<Rig> {
  const sandbox = await makeSandbox()
  const media = await makeMediaDir()
  return continueRig(sandbox, media, posts)
}

function continueRig(sandbox: string, media: string, posts = 8): Rig {
  const fetch = makeFakeFetch()
  const deps: SeedDeps = {
    git: createLocalGitAdapter({ dir: sandbox }),
    storage: createLocalStorage({ dir: media, baseUrl: '/media' }),
    image: makeStubImage(),
    users: makeFakeUserStore(),
    fetch: { fetchImpl: fetch.fetchImpl },
    probeApiLive: () => Promise.resolve(false),
    now: () => 1752600000000
  }
  return {
    sandbox,
    media,
    fetch,
    deps,
    options: {
      sandboxDir: sandbox,
      mediaDir: media,
      pack: makePack(PACK_POSTS),
      posts,
      users: { admin: 1, author: 1 },
      draftFraction: 0,
      concurrency: 2,
      deps
    }
  }
}

/** Wrap a GitPort so commitFiles throws once when the message matches —
 *  simulating a hard crash at the worst moment (state written, commit lost
 *  or vice versa is impossible now: the throw IS the crash boundary). */
function crashingGit(
  git: GitPort,
  messagePrefix: string
): { port: GitPort; crashed: () => boolean } {
  let crashed = false
  const port: GitPort = {
    ...git,
    commitFiles: async (input) => {
      if (!crashed && input.message.startsWith(messagePrefix)) {
        crashed = true
        throw new Error(`simulated crash at: ${input.message}`)
      }
      return git.commitFiles(input)
    }
  }
  return { port, crashed: () => crashed }
}

describe('crash-safety invariant (manifest before side effects)', () => {
  it('a crash at the first post-chunk commit leaves no duplicates and full removability', async () => {
    const rig = await makeRig()
    const crash = crashingGit(rig.deps.git!, 'demo-data: seed')
    await expect(
      seedDemoData({ ...rig.options, deps: { ...rig.deps, git: crash.port } })
    ).rejects.toThrow('simulated crash')
    expect(crash.crashed()).toBe(true)

    // Intent landed BEFORE the crash: every planned post/key is removable.
    const midManifest = await loadManifest(rig.sandbox)
    expect(midManifest.posts).toHaveLength(8)
    expect(midManifest.mediaKeys).toHaveLength(8)

    // "New process" resumes: no duplicate slugs, no re-downloads (the crashed
    // run's ingested media is recognized as ours via the manifest).
    const resume = continueRig(rig.sandbox, rig.media)
    const summary = await seedDemoData(resume.options)
    expect(summary.posts).toBe(8)
    expect(summary.images + summary.imagesReused).toBe(8)
    expect(resume.fetch.calls).toHaveLength(0) // all reused, zero downloads

    const manifest = await loadManifest(rig.sandbox)
    expect(manifest.posts).toHaveLength(8)
    const slugs = manifest.posts.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(slugs.every((s) => /^artwork-\d+$/.test(s))).toBe(true) // no -<packId> dupes
    expect(new Set(manifest.mediaKeys).size).toBe(8) // no suffixed orphan keys

    // And unseed removes ALL of it, including anything the crashed run made.
    const removed = await removeSeeded({
      sandboxDir: rig.sandbox,
      mediaDir: rig.media,
      deps: continueRig(rig.sandbox, rig.media).deps
    })
    expect(removed.posts).toBe(8)
    expect(removed.media).toBe(8)
  })

  it('a crash at the categories commit still leaves the added slugs removable', async () => {
    const rig = await makeRig()
    const crash = crashingGit(rig.deps.git!, 'demo-data: register')
    await expect(
      seedDemoData({ ...rig.options, deps: { ...rig.deps, git: crash.port } })
    ).rejects.toThrow('simulated crash')

    // Intent (category slugs) already in the manifest despite the lost commit.
    const midManifest = await loadManifest(rig.sandbox)
    expect(midManifest.categories).toEqual(['prints-and-drawings'])

    const resume = continueRig(rig.sandbox, rig.media)
    await seedDemoData(resume.options)
    const removed = await removeSeeded({
      sandboxDir: rig.sandbox,
      mediaDir: rig.media,
      deps: continueRig(rig.sandbox, rig.media).deps
    })
    expect(removed.categories).toBe(1)
  })
})

describe('dataset-aware resume key', () => {
  it('the AIC pack fingerprints its source so different datasets never share a checkpoint', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'demo-fp-'))
    const a = path.join(dir, 'a.jsonl')
    const b = path.join(dir, 'b.jsonl')
    await writeFile(a, '{}\n', 'utf8')
    await writeFile(b, '{}\n{}\n', 'utf8')
    const fpA = createAicPack({ source: a }).meta.sourceFingerprint
    const fpB = createAicPack({ source: b }).meta.sourceFingerprint
    expect(fpA).toBeTruthy()
    expect(fpB).toBeTruthy()
    expect(fpA).not.toBe(fpB)
    expect(fpA).toContain(path.resolve(a))
  })
})

describe('media-key collision parity with the upload route', () => {
  it('a foreign ingest manifest at the planned key (no .jpg original) forces a suffix', async () => {
    const rig = await makeRig(1)
    // A user upload with a NON-jpg extension owns this key only via its
    // manifest sidecar — exactly the case the original probe missed.
    const foreign = manifestKey('1910/01/artwork-1')
    await rig.deps.storage!.put(
      foreign,
      new TextEncoder().encode('{"original":{"key":"1910/01/artwork-1.png"}}'),
      { contentType: 'application/json' }
    )
    await seedDemoData(rig.options)

    const manifest = await loadManifest(rig.sandbox)
    expect(manifest.mediaKeys).toEqual(['1910/01/artwork-1-2'])
    const raw = await readFile(
      path.join(rig.sandbox, 'content', 'post', 'en', 'artwork-1.mdoc'),
      'utf8'
    )
    expect(parseMdoc(raw).frontmatter['featuredImage']).toBe(
      '/media/1910/01/artwork-1-2.jpg'
    )
    // The user's sidecar is untouched.
    const survived = await rig.deps.storage!.get(foreign)
    expect(survived).not.toBeNull()
  })
})

describe('fail-closed unseed', () => {
  it('refuses to run against a corrupt manifest and leaves the file intact', async () => {
    const rig = await makeRig(2)
    await seedDemoData(rig.options)
    const file = path.join(rig.sandbox, '.setu', 'demo-seed-manifest.json')
    await writeFile(file, '{ not json', 'utf8')

    await expect(
      removeSeeded({
        sandboxDir: rig.sandbox,
        mediaDir: rig.media,
        deps: continueRig(rig.sandbox, rig.media).deps
      })
    ).rejects.toThrow('not a valid seed manifest')
    expect(await readFile(file, 'utf8')).toBe('{ not json') // untouched
  })

  it('never deletes users outside the demo-email pattern', async () => {
    const rig = await makeRig(2)
    await seedDemoData(rig.options)
    // A hand-edited manifest names a real account.
    const file = path.join(rig.sandbox, '.setu', 'demo-seed-manifest.json')
    const manifest = JSON.parse(await readFile(file, 'utf8')) as {
      users: Array<{ email: string; role: string }>
    }
    manifest.users.push({ email: 'real-person@example.com', role: 'admin' })
    await writeFile(file, JSON.stringify(manifest), 'utf8')

    const resume = continueRig(rig.sandbox, rig.media)
    await resume.deps.users!.create({
      email: 'real-person@example.com',
      name: 'Real Person',
      role: 'admin',
      password: 'irrelevant-Password-1'
    })
    const removed = await removeSeeded({
      sandboxDir: rig.sandbox,
      mediaDir: rig.media,
      deps: resume.deps
    })
    expect(removed.usersSkipped).toBe(1)
    expect(
      await resume.deps.users!.findByEmail('real-person@example.com')
    ).not.toBeNull()
  })
})

describe('strict CLI flags', () => {
  it('rejects non-integer counts instead of truncating', () => {
    expect(() => intFlag('1.5', '--posts', 0)).toThrow('Invalid --posts')
    expect(() => intFlag('12abc', '--posts', 0)).toThrow('Invalid --posts')
    expect(intFlag('12', '--posts', 0)).toBe(12)
    expect(intFlag(undefined, '--posts', 7)).toBe(7)
  })

  it('unseed rejects seed-only flags', () => {
    expect(() =>
      parseSeedFlags(['--posts', '5'], ['sandbox', 'media'])
    ).toThrow('not valid for this command')
    expect(() =>
      parseSeedFlags(['--sandbox', '/tmp/x'], ['sandbox', 'media'])
    ).not.toThrow()
  })
})
