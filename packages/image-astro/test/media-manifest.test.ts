import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { manifestKeyFromSrc, loadManifest } from '../src/lib/media-manifest'

const dirs: string[] = []
const prev = process.env.SETU_MEDIA_DIR
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  if (prev === undefined) delete process.env.SETU_MEDIA_DIR
  else process.env.SETU_MEDIA_DIR = prev
})

function tmpWith(mediaKey: string, manifest: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mm-'))
  dirs.push(dir)
  const parts = mediaKey.split('/')
  const slug = parts.pop()!
  const md = join(dir, ...parts)
  mkdirSync(md, { recursive: true })
  writeFileSync(join(md, `${slug}.manifest.json`), JSON.stringify(manifest))
  return dir
}

describe('manifestKeyFromSrc', () => {
  it('extracts the key from a root-relative /media/ src', () => {
    expect(manifestKeyFromSrc('/media/2026/06/my-cat-photo.jpg')).toBe('2026/06/my-cat-photo')
  })
  it('returns null for external or non-/media/ srcs', () => {
    expect(manifestKeyFromSrc('https://example.com/p.png')).toBeNull()
    expect(manifestKeyFromSrc('/assets/x.png')).toBeNull()
  })
})

describe('loadManifest', () => {
  const m = {
    id: '2026/06/cat',
    format: 'webp',
    original: { key: '2026/06/cat.jpg', width: 10, height: 6, format: 'jpeg' },
    variants: [{ width: 400, height: 240, key: '2026/06/cat-400w.webp', contentType: 'image/webp' }],
  }
  it('reads + parses a manifest from SETU_MEDIA_DIR', () => {
    process.env.SETU_MEDIA_DIR = tmpWith('2026/06/cat', m)
    expect(loadManifest('2026/06/cat')).toEqual(m)
  })
  it('returns null when the env is unset', () => {
    delete process.env.SETU_MEDIA_DIR
    expect(loadManifest('2026/06/cat')).toBeNull()
  })
  it('returns null for a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'))
    dirs.push(dir)
    process.env.SETU_MEDIA_DIR = dir
    expect(loadManifest('2026/06/nope')).toBeNull()
  })
  it('returns null for corrupt JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'))
    dirs.push(dir)
    const md = join(dir, '2026', '06')
    mkdirSync(md, { recursive: true })
    writeFileSync(join(md, 'bad.manifest.json'), '{ not json')
    process.env.SETU_MEDIA_DIR = dir
    expect(loadManifest('2026/06/bad')).toBeNull()
  })
})
