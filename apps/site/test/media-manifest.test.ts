import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { manifestIdFromSrc, loadManifest } from '../src/lib/media-manifest'

const dirs: string[] = []
const prev = process.env.SETU_MEDIA_DIR
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  if (prev === undefined) delete process.env.SETU_MEDIA_DIR
  else process.env.SETU_MEDIA_DIR = prev
})

function tmpWith(id: string, manifest: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'mm-'))
  dirs.push(dir)
  const md = join(dir, 'media', id)
  mkdirSync(md, { recursive: true })
  writeFileSync(join(md, 'manifest.json'), JSON.stringify(manifest))
  return dir
}

describe('manifestIdFromSrc', () => {
  it('extracts the id from a root-relative upload src', () => {
    expect(manifestIdFromSrc('/uploads/media/abc123/original.png')).toBe('abc123')
  })
  it('returns null for external or non-upload srcs', () => {
    expect(manifestIdFromSrc('https://example.com/p.png')).toBeNull()
    expect(manifestIdFromSrc('/assets/x.png')).toBeNull()
  })
})

describe('loadManifest', () => {
  const m = {
    id: 'abc',
    format: 'webp',
    original: { key: 'media/abc/original.png', width: 10, height: 6, format: 'png' },
    variants: [{ width: 400, height: 240, key: 'media/abc/w400.webp', contentType: 'image/webp' }],
  }
  it('reads + parses a manifest from SETU_MEDIA_DIR', () => {
    process.env.SETU_MEDIA_DIR = tmpWith('abc', m)
    expect(loadManifest('abc')).toEqual(m)
  })
  it('returns null when the env is unset', () => {
    delete process.env.SETU_MEDIA_DIR
    expect(loadManifest('abc')).toBeNull()
  })
  it('returns null for a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'))
    dirs.push(dir)
    process.env.SETU_MEDIA_DIR = dir
    expect(loadManifest('nope')).toBeNull()
  })
  it('returns null for corrupt JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-'))
    dirs.push(dir)
    const md = join(dir, 'media', 'bad')
    mkdirSync(md, { recursive: true })
    writeFileSync(join(md, 'manifest.json'), '{ not json')
    process.env.SETU_MEDIA_DIR = dir
    expect(loadManifest('bad')).toBeNull()
  })
})
