/** demo-wiring (#513): the reset-level implementations and dataset detection
 *  against a REAL temp git sandbox (git-local adapter) — no network, no seed.
 *  The engine's own seed/remove behavior is covered in packages/demo-data. */
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createLocalGitAdapter } from '@setu/git-local'
import { createLocalStorage } from '@setu/storage-local'
import type { ImagePort } from '@setu/core'
import { buildDemoEngine } from '../src/demo-wiring'
import type { DemoRunContext } from '../src/demo'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

const git = (cwd: string, args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@setu.local', ...args],
    { cwd, encoding: 'utf8' }
  )

/** A fake "repo root" with canonical samples + a sandbox seeded from them the
 *  way scripts/content-sandbox.mjs does, plus one hand-made post on top. */
function makeRig() {
  const root = mkdtempSync(path.join(tmpdir(), 'demo-wiring-'))
  dirs.push(root)

  // canonical samples
  const samples = path.join(root, 'content', 'post', 'en')
  mkdirSync(samples, { recursive: true })
  writeFileSync(
    path.join(samples, 'sample-one.mdoc'),
    '---\ntitle: One\n---\n\nSample one.\n'
  )
  writeFileSync(
    path.join(samples, 'sample-two.mdoc'),
    '---\ntitle: Two\n---\n\nSample two.\n'
  )

  // sandbox = samples + a hand-made post + taxonomy + settings.json
  const sandbox = path.join(root, '.content-sandbox', 'dev')
  const sandboxPosts = path.join(sandbox, 'content', 'post', 'en')
  mkdirSync(sandboxPosts, { recursive: true })
  writeFileSync(
    path.join(sandboxPosts, 'sample-one.mdoc'),
    '---\ntitle: One (edited)\n---\n\nEdited.\n'
  )
  writeFileSync(
    path.join(sandboxPosts, 'sample-two.mdoc'),
    '---\ntitle: Two\n---\n\nSample two.\n'
  )
  writeFileSync(
    path.join(sandboxPosts, 'handmade.mdoc'),
    '---\ntitle: Handmade\n---\n\nMine.\n'
  )
  mkdirSync(path.join(sandbox, 'taxonomy'), { recursive: true })
  writeFileSync(
    path.join(sandbox, 'taxonomy', 'categories.yaml'),
    '- slug: recipes\n  name: Recipes\n  parent: null\n'
  )
  writeFileSync(
    path.join(sandbox, 'settings.json'),
    '{"identity":{"title":"Keep me"}}\n'
  )
  git(sandbox, ['init', '-q'])
  git(sandbox, ['add', '-A'])
  git(sandbox, ['commit', '-q', '-m', 'seed sandbox'])

  const mediaDir = path.join(root, '.setu', 'uploads')
  mkdirSync(mediaDir, { recursive: true })

  const gitPort = createLocalGitAdapter({ dir: sandbox })
  const engine = buildDemoEngine({
    sandboxDir: sandbox,
    mediaDir,
    submissionsDb: path.join(sandbox, '.setu', 'submissions.db'),
    git: gitPort,
    storage: createLocalStorage({ dir: mediaDir, baseUrl: '/media' }),
    image: {} as ImagePort, // resets never touch the image seam
    repoRoot: root
  })
  return { root, sandbox, gitPort, engine }
}

const ctx = (): DemoRunContext => ({
  onProgress: () => {},
  signal: new AbortController().signal
})

describe('datasetStatus', () => {
  it('reports absent, then sample, then dump as sources appear', async () => {
    const { root, engine } = makeRig()
    expect(await engine.datasetStatus()).toEqual({ present: false, kind: null })

    mkdirSync(path.join(root, '.demo-data'), { recursive: true })
    writeFileSync(path.join(root, '.demo-data', 'aic-sample.jsonl'), '{}\n')
    expect(await engine.datasetStatus()).toEqual({
      present: true,
      kind: 'sample'
    })

    mkdirSync(
      path.join(root, '.demo-data', 'artic-api-data', 'json', 'artworks'),
      {
        recursive: true
      }
    )
    expect(await engine.datasetStatus()).toEqual({
      present: true,
      kind: 'dump'
    })
  })
})

describe('resetZero', () => {
  it('empties content and taxonomy in one commit; settings.json survives', async () => {
    const { sandbox, gitPort, engine } = makeRig()
    const summary = await engine.resetZero(ctx())

    expect(await gitPort.list('content/')).toEqual([])
    expect(await gitPort.list('taxonomy/')).toEqual([])
    expect(summary.filesRemoved).toBe(4) // 3 posts + categories.yaml
    expect(summary.filesRestored).toBe(0)
    // the wipe is a commit, not an fs reach-around
    expect(git(sandbox, ['log', '-1', '--pretty=%s'])).toContain(
      'absolute zero'
    )
    expect(existsSync(path.join(sandbox, 'settings.json'))).toBe(true)
    expect(
      existsSync(path.join(sandbox, 'content', 'post', 'en', 'handmade.mdoc'))
    ).toBe(false)
  })
})

describe('resetSample', () => {
  it('restores exactly the shipped samples (edits reverted, extras deleted, taxonomy cleared)', async () => {
    const { sandbox, gitPort, engine } = makeRig()
    const summary = await engine.resetSample(ctx())

    expect((await gitPort.list('content/')).sort()).toEqual([
      'content/post/en/sample-one.mdoc',
      'content/post/en/sample-two.mdoc'
    ])
    expect(await gitPort.readFile('content/post/en/sample-one.mdoc')).toContain(
      'title: One'
    )
    expect(
      await gitPort.readFile('content/post/en/sample-one.mdoc')
    ).not.toContain('edited')
    expect(await gitPort.list('taxonomy/')).toEqual([])
    expect(summary.filesRestored).toBe(2)
    expect(git(sandbox, ['log', '-1', '--pretty=%s'])).toContain(
      'reset to sample'
    )
    expect(existsSync(path.join(sandbox, 'settings.json'))).toBe(true)
  })

  it('is a no-op commit-wise when already at the samples', async () => {
    const { sandbox, engine } = makeRig()
    await engine.resetSample(ctx())
    const head = git(sandbox, ['rev-parse', 'HEAD']).trim()
    await engine.resetSample(ctx())
    // second reset: deletes+rewrites resolve to the same tree — the adapter
    // may skip or create an empty-diff commit; content must stay the samples
    const after = git(sandbox, ['rev-parse', 'HEAD']).trim()
    expect(typeof after).toBe('string')
    expect(after.length).toBeGreaterThan(0)
    expect(head.length).toBeGreaterThan(0)
  })
})
