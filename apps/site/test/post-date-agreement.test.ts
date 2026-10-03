import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serializeMdoc } from '@setu/core'
import { resolvePostDate } from '../src/lib/post-date'
import { toPostRow } from '../src/lib/post-row'
import { toPermalinkEntry } from '../src/lib/permalinks'
import { toRow } from '../../../scripts/gen-relations.mjs'

// #1121: four places date a post — the page/feed/sitemap resolver (resolvePostDate), the
// archive projection (toPostRow), the permalink projection (toPermalinkEntry) and the
// related-posts/redirect codegen (gen-relations toRow). They must agree: published date =
// frontmatter `date ?? pubDate` (core's parseFrontmatterDate), then git → mtime → now where
// that context exists. `updatedAt` is a modified date and never dates publication.

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'post-date-agree-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const cases: [string, Record<string, unknown>, number | null][] = [
  ['date only', { date: '2021-02-03' }, Date.parse('2021-02-03')],
  ['pubDate only', { pubDate: '2020-05-01' }, Date.parse('2020-05-01')],
  [
    'date beats pubDate',
    { date: '2021-02-03', pubDate: '2020-05-01' },
    Date.parse('2021-02-03')
  ],
  [
    'pubDate beats updatedAt',
    { pubDate: '2020-05-01', updatedAt: '2026-01-01' },
    Date.parse('2020-05-01')
  ],
  [
    'YAML Date pubDate',
    { pubDate: new Date('2019-03-04T00:00:00.000Z') },
    Date.parse('2019-03-04T00:00:00.000Z')
  ],
  [
    'updatedAt only → no frontmatter published date',
    { updatedAt: '2001-01-01' },
    null
  ],
  ['nothing', {}, null]
]

describe('the four post-date consumers agree', () => {
  it.each(cases)('%s', (label, data, expected) => {
    const slug = label.replace(/[^a-z]+/gi, '-').toLowerCase()
    const file = join(dir, 'post', 'en', `${slug}.mdoc`)
    rmSync(join(dir, 'post'), { recursive: true, force: true })
    mkdirSync(join(dir, 'post', 'en'), { recursive: true })
    writeFileSync(file, serializeMdoc({ frontmatter: data, body: 'body\n' }))
    const mtime = statSync(file).mtime.getTime()
    const id = `post/en/${slug}`

    const resolved = resolvePostDate({ data, filePath: file }).getTime()
    const row = toPostRow({ id, data })
    const permalink = toPermalinkEntry({ id, data })
    const related = toRow(file, dir) as {
      updatedAt: number
      permalinkDate: number | null
    }

    // The frontmatter-only consumers: exactly the shared rule, null when absent.
    expect(row.date).toBe(expected)
    expect(permalink.date).toBe(expected)
    expect(related.permalinkDate).toBe(expected)
    // The consumers with a fallback context: the shared rule, else the file (not in git →
    // mtime) — never the updatedAt value.
    expect(resolved).toBe(expected ?? mtime)
    expect(related.updatedAt).toBe(expected ?? mtime)
  })
})
