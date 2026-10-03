import { describe, it, expect } from 'vitest'
import {
  entryIdFromContentPath,
  isSiteEntryPath
} from '../../src/permalinks/entry-id'

describe('entryIdFromContentPath', () => {
  it('strips the .mdoc extension and keeps collection/locale/slug', () => {
    expect(entryIdFromContentPath('post/en/hello.mdoc')).toBe('post/en/hello')
  })

  it('keeps an index file as the slug "index" (no Astro-style /index stripping)', () => {
    expect(entryIdFromContentPath('page/en/index.mdoc')).toBe('page/en/index')
    expect(entryIdFromContentPath('page/en/docs/index.mdoc')).toBe(
      'page/en/docs/index'
    )
  })

  it('keeps case and dots verbatim (no github-slugger pass)', () => {
    expect(entryIdFromContentPath('post/en/V1.2-Release.mdoc')).toBe(
      'post/en/V1.2-Release'
    )
  })

  it('normalizes Windows separators to /', () => {
    expect(entryIdFromContentPath('post\\en\\hello.mdoc')).toBe('post/en/hello')
  })

  it('strips only a trailing extension', () => {
    expect(entryIdFromContentPath('post/en/a.mdoc.mdoc')).toBe('post/en/a.mdoc')
  })
})

describe('isSiteEntryPath', () => {
  it('accepts .mdoc files at any depth', () => {
    expect(isSiteEntryPath('post/en/hello.mdoc')).toBe(true)
    expect(isSiteEntryPath('page/en/docs/intro.mdoc')).toBe(true)
  })

  it('rejects other extensions', () => {
    expect(isSiteEntryPath('post/en/hello.md')).toBe(false)
    expect(isSiteEntryPath('post/en/hello.mdoc.bak')).toBe(false)
  })

  it('rejects any dot-prefixed segment, like the site glob loader (dot: false)', () => {
    expect(isSiteEntryPath('post/en/.hidden.mdoc')).toBe(false)
    expect(isSiteEntryPath('post/.drafts/x.mdoc')).toBe(false)
    expect(isSiteEntryPath('.git/x.mdoc')).toBe(false)
  })
})
