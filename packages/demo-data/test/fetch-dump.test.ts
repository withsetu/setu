import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import {
  fetchAicDump,
  AIC_DUMP_URL,
  AIC_DUMP_ARTWORKS_PATH
} from '../src/index'

// NO network in tests: fetchImpl is a canned Response and resolveHost returns a
// public address so safeFetch's SSRF checks pass without touching DNS.
const fakeNet = {
  fetchImpl: (async () =>
    new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200
    })) as typeof fetch,
  resolveHost: async () => ['93.184.216.34']
}

describe('fetchAicDump', () => {
  it('publishes the verified https dump URL and artworks path', () => {
    const url = new URL(AIC_DUMP_URL)
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('artic-api-data.s3.amazonaws.com')
    expect(AIC_DUMP_ARTWORKS_PATH).toBe('artic-api-data/json/artworks')
  })

  it('downloads the tarball to destDir (extract: false)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'demo-data-dump-'))
    const result = await fetchAicDump(dir, { ...fakeNet, extract: false })
    expect(result.tarballPath).toBe(path.join(dir, 'artic-api-data.tar.bz2'))
    expect(result.artworksDir).toBeNull()
    const written = await readFile(result.tarballPath)
    expect(Array.from(written)).toEqual([1, 2, 3, 4])
  })

  it('extracts only the artworks subtree via the injected tar runner', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'demo-data-dump-'))
    const runTar = vi.fn(async (_args: string[], cwd: string) => {
      await mkdir(path.join(cwd, AIC_DUMP_ARTWORKS_PATH), { recursive: true })
    })
    const result = await fetchAicDump(dir, { ...fakeNet, runTar })
    expect(runTar).toHaveBeenCalledWith(
      [
        '-xjf',
        path.join(dir, 'artic-api-data.tar.bz2'),
        AIC_DUMP_ARTWORKS_PATH
      ],
      dir
    )
    expect(result.artworksDir).toBe(path.join(dir, AIC_DUMP_ARTWORKS_PATH))
  })

  it('resolves a RELATIVE destDir before handing paths to tar (regression: the CLI default ".demo-data" made tar look for destDir/destDir/…)', async () => {
    const relative = `.tmp-fetch-dump-test-${process.pid}`
    const absolute = path.resolve(relative)
    try {
      const runTar = vi.fn(async (args: string[], cwd: string) => {
        // tar runs with cwd=destDir; every path it receives must be absolute
        // (or the test would pass only for absolute destDirs, hiding the bug).
        expect(path.isAbsolute(cwd)).toBe(true)
        expect(path.isAbsolute(args[1]!)).toBe(true)
        await mkdir(path.join(cwd, AIC_DUMP_ARTWORKS_PATH), {
          recursive: true
        })
      })
      const result = await fetchAicDump(relative, { ...fakeNet, runTar })
      expect(runTar).toHaveBeenCalledWith(
        [
          '-xjf',
          path.join(absolute, 'artic-api-data.tar.bz2'),
          AIC_DUMP_ARTWORKS_PATH
        ],
        absolute
      )
      expect(result.tarballPath).toBe(
        path.join(absolute, 'artic-api-data.tar.bz2')
      )
      expect(result.artworksDir).toBe(
        path.join(absolute, AIC_DUMP_ARTWORKS_PATH)
      )
      expect(Array.from(await readFile(result.tarballPath))).toEqual([
        1, 2, 3, 4
      ])
    } finally {
      await rm(absolute, { recursive: true, force: true })
    }
  })

  it('reuses an existing non-empty tarball instead of re-downloading', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'demo-data-dump-'))
    const tarballPath = path.join(dir, 'artic-api-data.tar.bz2')
    await writeFile(tarballPath, new Uint8Array([9, 9, 9]))
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const result = await fetchAicDump(dir, {
      ...fakeNet,
      fetchImpl,
      extract: false
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.downloaded).toBe(false)
    expect(Array.from(await readFile(tarballPath))).toEqual([9, 9, 9])
  })

  it('fails when extraction does not produce the artworks directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'demo-data-dump-'))
    const runTar = vi.fn(async () => {})
    await expect(fetchAicDump(dir, { ...fakeNet, runTar })).rejects.toThrow(
      /artworks/
    )
  })
})
