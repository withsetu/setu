import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateEntryMetadata } from '@setu/core'
import {
  FALLBACK_CONFIG,
  loadSetuConfig,
  resolveSetuConfigPath
} from '../src/setu-config'

const tmp = () => mkdtempSync(join(tmpdir(), 'setu-config-'))

afterEach(() => vi.restoreAllMocks())

describe('resolveSetuConfigPath', () => {
  it('prefers SETU_CONFIG_PATH and returns it absolute', () => {
    const dir = tmp()
    const p = join(dir, 'custom.config.ts')
    writeFileSync(p, 'export default {}')
    expect(resolveSetuConfigPath({ SETU_CONFIG_PATH: p }, '/nowhere')).toBe(p)
  })

  it('falls back to <repoDir>/setu.config.ts when it exists', () => {
    const dir = tmp()
    const p = join(dir, 'setu.config.ts')
    writeFileSync(p, 'export default {}')
    expect(resolveSetuConfigPath({}, dir)).toBe(p)
  })

  it('returns null when there is no config to load', () => {
    expect(resolveSetuConfigPath({}, tmp())).toBeNull()
  })
})

describe('loadSetuConfig', () => {
  it('loads declared collections from a real config file', async () => {
    const dir = tmp()
    const p = join(dir, 'setu.config.ts')
    writeFileSync(
      p,
      `import { z } from 'zod'
       export default {
         collections: [{ name: 'product', fields: z.object({ sku: z.string() }) }]
       }`
    )
    const config = await loadSetuConfig(p)
    expect([...config.collectionsByName.keys()].sort()).toEqual([
      'page',
      'post',
      'product'
    ])
  })

  // The regression that a same-process unit test cannot see: setu.config is jiti-loaded,
  // so its `z.object(...)` may come from a DIFFERENT zod copy than core's. `.merge()` then
  // carried a foreign ZodNever catchall whose `instanceof` check failed inside zod, so every
  // undeclared frontmatter key was rejected with "Expected never, received string" — which
  // in the live app meant `cid` (stamped by the publish path) made every entry unsaveable.
  it('keeps passthrough for undeclared keys on a jiti-loaded config', async () => {
    const dir = tmp()
    const p = join(dir, 'setu.config.ts')
    writeFileSync(
      p,
      `import { z } from 'zod'
       export default {
         collections: [{ name: 'product', fields: z.object({ sku: z.string() }) }]
       }`
    )
    const config = await loadSetuConfig(p)
    const result = validateEntryMetadata(config, 'product', {
      title: 'Polygrout',
      sku: 'PG-100',
      cid: '01JABCDEF',
      pubDate: '2026-01-01'
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value['cid']).toBe('01JABCDEF')
      expect(result.value['pubDate']).toBe('2026-01-01')
    }
  })

  it('still enforces the declared fields on a jiti-loaded config', async () => {
    const dir = tmp()
    const p = join(dir, 'setu.config.ts')
    writeFileSync(
      p,
      `import { z } from 'zod'
       export default {
         collections: [{ name: 'product', fields: z.object({ sku: z.string() }) }]
       }`
    )
    const config = await loadSetuConfig(p)
    const result = validateEntryMetadata(config, 'product', { title: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]?.path).toBe('sku')
  })

  // The half the shape-spread in resolveCollection could NOT fix. Spreading the shape keeps the
  // catchall as core's own, but the field schemas INSIDE that shape still belong to whichever zod
  // the config imported — and core's 3.x parser cannot drive a 4.x schema, so validation blows up
  // at the root (path '') instead of per-field. A site resolves `zod` from its own directory, so
  // any project with zod 4 installed hits this. Fixed by aliasing the config's `zod` to core's.
  it("uses core's zod even when the config's own directory has a different major", async () => {
    const dir = tmp()
    mkdirSync(join(dir, 'node_modules'), { recursive: true })
    symlinkSync(foreignZodDir(), join(dir, 'node_modules', 'zod'), 'dir')
    const p = join(dir, 'setu.config.ts')
    writeFileSync(
      p,
      `import { z } from 'zod'
       export default {
         collections: [{ name: 'product', fields: z.object({ sku: z.string() }) }]
       }`
    )
    const config = await loadSetuConfig(p)

    // Passthrough still holds for undeclared keys (the `cid` case that made entries unsaveable).
    const ok = validateEntryMetadata(config, 'product', {
      title: 'Polygrout',
      sku: 'PG-100',
      cid: '01JABCDEF'
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value['cid']).toBe('01JABCDEF')

    // And the declared field is still enforced, per-field rather than at the root.
    const bad = validateEntryMetadata(config, 'product', { title: 'X' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors[0]?.path).toBe('sku')
  })

  it('degrades to the built-in collections when there is no config, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await loadSetuConfig(null)).toBe(FALLBACK_CONFIG)
    expect(warn).toHaveBeenCalledOnce()
  })

  // A broken config must not take the process down — the server still boots and serves; only
  // field enforcement degrades. Mirrors resolveAuthSecret's posture in apps/api/src/config.ts.
  it('degrades loudly instead of throwing when the config is broken', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = tmp()
    const p = join(dir, 'setu.config.ts')
    writeFileSync(p, 'this is not valid typescript {{{')
    expect(await loadSetuConfig(p)).toBe(FALLBACK_CONFIG)
    expect(error).toHaveBeenCalledOnce()
  })

  it('degrades loudly when the config has no default export', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = tmp()
    const p = join(dir, 'setu.config.ts')
    writeFileSync(p, 'export const notDefault = {}')
    expect(await loadSetuConfig(p)).toBe(FALLBACK_CONFIG)
    expect(error).toHaveBeenCalledOnce()
  })

  it('degrades loudly when the config is invalid (a reserved collection name)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = tmp()
    const p = join(dir, 'setu.config.ts')
    writeFileSync(p, `export default { collections: [{ name: 'tag' }] }`)
    expect(await loadSetuConfig(p)).toBe(FALLBACK_CONFIG)
    expect(error).toHaveBeenCalledOnce()
  })

  it('the fallback carries exactly the built-in collections', () => {
    expect([...FALLBACK_CONFIG.collectionsByName.keys()].sort()).toEqual([
      'page',
      'post'
    ])
  })
})

/**
 * The repo genuinely carries two zod majors and always will: core validates with 3.x, while
 * `@setu/auth` pulls 4.x because better-auth's `better-call` requires it. Locate the 4.x copy
 * so the test below can put it where a site's config would find it.
 *
 * Asserted to actually BE major 4 at call time: if the dual copy ever disappears this must fail
 * loudly rather than quietly degrade into a test that proves nothing (CLAUDE.md §3.3 #4).
 */
function foreignZodDir(): string {
  const authDir = fileURLToPath(
    new URL('../../../packages/auth/', import.meta.url)
  )
  const resolved = createRequire(join(authDir, 'package.json')).resolve(
    'zod/package.json'
  )
  const version = JSON.parse(readFileSync(resolved, 'utf8')).version as string
  if (!version.startsWith('4.'))
    throw new Error(
      `foreignZodDir: expected @setu/auth to resolve zod 4.x, got ${version}. ` +
        'This test exists to prove core ignores a foreign zod copy — with only one copy ' +
        'left in the tree it can no longer prove anything. Update or delete it deliberately.'
    )
  return dirname(resolved)
}
