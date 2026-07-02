import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { contentRepoRoot } from '../src/lib/content-root'

const withoutContentDir = <T>(fn: () => T): T => {
  const prev = process.env.SETU_CONTENT_DIR
  delete process.env.SETU_CONTENT_DIR
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env.SETU_CONTENT_DIR
    else process.env.SETU_CONTENT_DIR = prev
  }
}

let made = ''
afterEach(() => {
  if (made) rmSync(made, { recursive: true, force: true })
  made = ''
})

describe('contentRepoRoot', () => {
  it('returns the parent of SETU_CONTENT_DIR when set', () => {
    const prev = process.env.SETU_CONTENT_DIR
    process.env.SETU_CONTENT_DIR = join('/tmp', 'site-root', 'content')
    try {
      expect(contentRepoRoot()).toBe(join('/tmp', 'site-root'))
    } finally {
      if (prev === undefined) delete process.env.SETU_CONTENT_DIR
      else process.env.SETU_CONTENT_DIR = prev
    }
  })

  it('walks up from `from` to the ancestor containing content/', () => {
    made = mkdtempSync(join(tmpdir(), 'content-root-'))
    mkdirSync(join(made, 'content'), { recursive: true })
    mkdirSync(join(made, 'apps', 'site'), { recursive: true })
    withoutContentDir(() => {
      expect(contentRepoRoot(join(made, 'apps', 'site'))).toBe(made)
    })
  })

  it('falls back to `from` when no content/ ancestor exists', () => {
    made = mkdtempSync(join(tmpdir(), 'content-root-none-'))
    mkdirSync(join(made, 'apps', 'site'), { recursive: true })
    withoutContentDir(() => {
      const start = join(made, 'apps', 'site')
      expect(contentRepoRoot(start)).toBe(start)
    })
  })
})
