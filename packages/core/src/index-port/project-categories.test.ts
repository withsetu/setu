import { describe, expect, it } from 'vitest'
import { projectRow, rowToContentRow } from './types'
import type { ContentRow } from '../content-index/list-entries'

const row: ContentRow = {
  ref: { collection: 'post', locale: 'en', slug: 'a' },
  title: 'A',
  locale: 'en',
  lifecycle: { state: 'draft' },
  updatedAt: 1,
  hasDraft: true,
  date: null,
  tags: [],
  categories: ['react', 'tutorials'],
  mediaRefs: [],
  audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 }
}

describe('projectRow / rowToContentRow — categories', () => {
  it('projects categories onto the index row', () => {
    expect(projectRow(row).categories).toEqual(['react', 'tutorials'])
  })
  it('round-trips categories back to a content row', () => {
    expect(rowToContentRow(projectRow(row)).categories).toEqual([
      'react',
      'tutorials'
    ])
  })
})
