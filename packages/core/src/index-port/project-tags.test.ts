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
  tags: ['react', 'redux'],
  categories: [],
  mediaRefs: [],
  audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 },
}

describe('projectRow / rowToContentRow — tags', () => {
  it('projects tags onto the index row', () => {
    expect(projectRow(row).tags).toEqual(['react', 'redux'])
  })
  it('round-trips tags back to a content row', () => {
    expect(rowToContentRow(projectRow(row)).tags).toEqual(['react', 'redux'])
  })
})
