import { describe, expect, it } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { serializeMdoc } from '@setu/core'
import type { DraftInput, TiptapDoc } from '@setu/core'
import { mintSlug, slugify, uniqueSlug } from '../src/editor/new-entry'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})

describe('slugify', () => {
  it('lowercases and hyphenates words', () => {
    expect(slugify('Post Test')).toBe('post-test')
    expect(slugify('  Hello   World  ')).toBe('hello-world')
  })
  it('drops punctuation and collapses separators', () => {
    expect(slugify("It's a Test! (v2)")).toBe('its-a-test-v2')
    expect(slugify('a__b--c')).toBe('a-b-c')
  })
  it('keeps unicode letters/numbers', () => {
    expect(slugify('Café 99')).toBe('café-99')
  })
  it('returns empty for a symbol-only or blank title', () => {
    expect(slugify('   ')).toBe('')
    expect(slugify('!!!')).toBe('')
  })
})

describe('uniqueSlug', () => {
  it('returns the base when free', () => {
    expect(uniqueSlug('hello', new Set())).toBe('hello')
  })
  it('falls back to untitled for an empty base', () => {
    expect(uniqueSlug('', new Set())).toBe('untitled')
  })
  it('bumps with -2, -3 on collision', () => {
    expect(uniqueSlug('hello', new Set(['hello']))).toBe('hello-2')
    expect(uniqueSlug('hello', new Set(['hello', 'hello-2']))).toBe('hello-3')
  })
})

describe('mintSlug', () => {
  it('derives a slug from the title', async () => {
    const slug = await mintSlug(
      createMemoryDataPort([]),
      createMemoryGitPort([]),
      'post',
      'en',
      'Post Test'
    )
    expect(slug).toBe('post-test')
  })

  it('avoids an existing DRAFT slug in the same collection+locale', async () => {
    const seed: DraftInput[] = [
      {
        collection: 'post',
        locale: 'en',
        slug: 'hello',
        content: doc('x'),
        metadata: {}
      }
    ]
    const slug = await mintSlug(
      createMemoryDataPort(seed),
      createMemoryGitPort([]),
      'post',
      'en',
      'Hello'
    )
    expect(slug).toBe('hello-2')
  })

  it('avoids an existing COMMITTED slug', async () => {
    const git = createMemoryGitPort([
      {
        path: 'content/post/en/hello.mdoc',
        content: serializeMdoc({ frontmatter: { title: 'Hello' }, body: 'hi' })
      }
    ])
    const slug = await mintSlug(
      createMemoryDataPort([]),
      git,
      'post',
      'en',
      'Hello'
    )
    expect(slug).toBe('hello-2')
  })

  it('does not collide across a different locale', async () => {
    const seed: DraftInput[] = [
      {
        collection: 'post',
        locale: 'fr',
        slug: 'hello',
        content: doc('x'),
        metadata: {}
      }
    ]
    const slug = await mintSlug(
      createMemoryDataPort(seed),
      createMemoryGitPort([]),
      'post',
      'en',
      'Hello'
    )
    expect(slug).toBe('hello')
  })

  it('reserves the `new` sentinel', async () => {
    const slug = await mintSlug(
      createMemoryDataPort([]),
      createMemoryGitPort([]),
      'post',
      'en',
      'New'
    )
    expect(slug).toBe('new-2')
  })
})
