import { describe, it, expect } from 'vitest'
import type { ContentRow } from '../../src/index'
import { projectRow, rowToContentRow, indexKey } from '../../src/index'

const cr: ContentRow = {
  ref: { collection: 'post', locale: 'en', slug: 'hello' },
  title: 'Hello',
  locale: 'en',
  lifecycle: { state: 'staged', pending: 'edited' },
  updatedAt: 5,
  hasDraft: true,
  date: null,
  tags: [],
  categories: [],
  mediaRefs: [],
  hasFeaturedImage: false,
  hasSeoOverrides: false
}

describe('index-port projection', () => {
  it('indexKey is NUL-joined', () => {
    expect(indexKey(cr.ref)).toBe('post\0en\0hello')
  })

  it('projectRow flattens a ContentRow into an index row', () => {
    expect(projectRow(cr)).toEqual({
      key: 'post\0en\0hello',
      collection: 'post',
      locale: 'en',
      slug: 'hello',
      title: 'Hello',
      titleLower: 'hello',
      status: 'staged',
      pending: 'edited',
      updatedAt: 5,
      hasDraft: true,
      date: null,
      tags: [],
      categories: [],
      mediaRefs: [],
      hasFeaturedImage: false,
      hasSeoOverrides: false
    })
  })

  it('rowToContentRow is the inverse projection', () => {
    expect(rowToContentRow(projectRow(cr))).toEqual(cr)
  })
})
