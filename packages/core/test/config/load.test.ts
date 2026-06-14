import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../../src/index'

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

describe('loadConfig', () => {
  it('loads and resolves a real saytu.config.ts via jiti', async () => {
    const resolved = await loadConfig(fixture('saytu.config.ts'))
    expect([...resolved.knownBlockTags]).toEqual(['callout'])
    expect(resolved.blocksByTag.get('callout')?.component).toBe('./Callout.astro')
  })

  it('throws when the config module has no default export', async () => {
    await expect(loadConfig(fixture('no-default.ts'))).rejects.toThrow(/no default export/i)
  })
})
