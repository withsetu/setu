import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
