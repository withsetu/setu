import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
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

  it('fails when extraction does not produce the artworks directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'demo-data-dump-'))
    const runTar = vi.fn(async () => {})
    await expect(fetchAicDump(dir, { ...fakeNet, runTar })).rejects.toThrow(
      /artworks/
    )
  })
})
