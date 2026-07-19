import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectAicSource } from '../../src/engine/resolve-dirs'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

const tmpRoot = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'demo-detect-'))
  dirs.push(dir)
  return dir
}

describe('detectAicSource', () => {
  it('returns null when no source exists under the root', async () => {
    expect(await detectAicSource(tmpRoot())).toBeNull()
  })

  it('prefers the extracted dump directory over a sampled jsonl', async () => {
    const root = tmpRoot()
    const dump = path.join(
      root,
      '.demo-data',
      'artic-api-data',
      'json',
      'artworks'
    )
    mkdirSync(dump, { recursive: true })
    mkdirSync(path.join(root, '.demo-data'), { recursive: true })
    writeFileSync(path.join(root, '.demo-data', 'aic-sample.jsonl'), '{}\n')
    expect(await detectAicSource(root)).toBe(dump)
  })

  it('falls back to the sampled jsonl (repo-root then package-local)', async () => {
    const root = tmpRoot()
    const sample = path.join(
      root,
      'packages',
      'demo-data',
      '.demo-data',
      'aic-sample.jsonl'
    )
    mkdirSync(path.dirname(sample), { recursive: true })
    writeFileSync(sample, '{}\n')
    expect(await detectAicSource(root)).toBe(sample)
  })
})
