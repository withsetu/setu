import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
