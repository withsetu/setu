import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { collectPosts } from '../src/contract'
import {
  createAicPack,
  AIC_IIIF_BASE,
  AIC_RELAXED_BODY_NOTE
} from '../src/index'

const fixturesDir = fileURLToPath(
  new URL('./fixtures/artworks', import.meta.url)
)

const load = async () => {
  const pack = createAicPack({ source: fixturesDir })
  const dataset = pack.load()
  const posts = await collectPosts(dataset)
  return { posts, stats: dataset.stats() }
}

describe('createAicPack over the synthetic fixture dump', () => {
  it('loads exactly the public-domain, imaged, described, dated records — in numeric id order', async () => {
    const { posts } = await load()
    expect(posts.map((p) => p.id)).toEqual(['101', '102', '108', '110'])
  })

  it('counts every skip reason without crashing on bad records', async () => {
    const { stats } = await load()
    expect(stats).toEqual({
      scanned: 11,
      loaded: 4,
      skipped: {
        invalid: 2, // 106 (no title, zod) + 107 (not JSON)
        notPublicDomain: 1, // 103
        noImage: 1, // 104
        noText: 2, // 105 (no text at all) + 111 (short_description only — strict tier)
        noDate: 1 // 109
      }
    })
  })

  it('builds IIIF URLs exactly per the verified pattern for widths 200/843/1686', async () => {
    const { posts } = await load()
    const image = posts[0]!.image!
    const id = 'aaaa1111-bbbb-2222-cccc-333344445555'
    expect(image.urlForWidth(200)).toBe(
      `${AIC_IIIF_BASE}/${id}/full/200,/0/default.jpg`
    )
    expect(image.urlForWidth(843)).toBe(
      `${AIC_IIIF_BASE}/${id}/full/843,/0/default.jpg`
    )
    expect(image.urlForWidth(1686)).toBe(
      `${AIC_IIIF_BASE}/${id}/full/1686,/0/default.jpg`
    )
  })

  it('carries intrinsic dimensions, alt text, and an image license', async () => {
    const { posts } = await load()
    const image = posts[0]!.image!
    expect(image.maxWidth).toBe(8000)
    expect(image.maxHeight).toBe(5333)
    expect(image.alt).toBe('Painting of boats in a harbor at dusk.')
    expect(image.license).toContain('CC0')
    // 102 has no thumbnail — dims stay undefined, ref still works.
    const bare = posts[1]!.image!
    expect(bare.maxWidth).toBeUndefined()
    expect(bare.urlForWidth(400)).toContain('/full/400,/0/default.jpg')
  })

  it('derives the date from the completion year, with source-timestamp fallback', async () => {
    const { posts } = await load()
    // 101: date_end 1899 → Jan 1 of that year, UTC.
    expect(posts[0]!.date).toBe('1899-01-01T00:00:00.000Z')
    // 102: no creation years → source_updated_at.
    expect(posts[1]!.date).toBe(
      new Date('2026-03-15T08:30:00-05:00').toISOString()
    )
    // 108: BCE years are outside the honest 1..9999 mapping → source_updated_at.
    expect(posts[2]!.date).toBe(
      new Date('2026-02-20T09:00:00-06:00').toISOString()
    )
    // 110: ancient years 1..99 must NOT hit the JS two-digit-year rule
    // (Date.UTC(79, …) would be 1979) — 79 CE maps to year 0079.
    expect(posts[3]!.date).toBe('0079-01-01T00:00:00.000Z')
  })

  it('composes the body from real fields with the required attribution lines', async () => {
    const { posts } = await load()
    const body = posts[0]!.body
    expect(body).toContain('A luminous harbor scene')
    expect(body).toContain(
      '**Artist:** Imaginaria Vestal (Fictional, 1850–1920)'
    )
    expect(body).toContain('**Medium:** Oil on canvas')
    expect(body).toContain('https://www.artic.edu/artworks/101')
    expect(body).toContain(
      '[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)'
    )
    expect(body).toContain(
      'Description © Art Institute of Chicago, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)'
    )
  })

  it('converts rich description HTML (em/strong/link/list) to markdown', async () => {
    const { posts } = await load()
    const body = posts[2]!.body
    expect(body).toContain('*amphora*')
    expect(body).toContain('**Invented Games**')
    expect(body).toContain('[festival notes](https://example.org/games)')
    expect(body).toContain('- runners mid-stride')
    expect(body).not.toContain('<p>')
  })

  it('groups terms by taxonomy: categories from department/classification, tags from terms/materials', async () => {
    const { posts } = await load()
    expect(posts[0]!.terms).toEqual({
      categories: ['Painting and Sculpture of Testland', 'oil on canvas'],
      // deduplicated case-insensitively ("painting" vs "Painting"), order-stable
      tags: [
        'harbor',
        'dusk',
        'boats',
        'painting',
        'oil paint (paint)',
        'canvas'
      ]
    })
    // No terms at all → empty arrays except the department category.
    expect(posts[1]!.terms).toEqual({
      categories: ['Prints and Drawings of Testland'],
      tags: []
    })
  })

  it('falls back honestly for excerpt and attribution when optional fields are missing', async () => {
    const { posts } = await load()
    // 101 uses short_description verbatim.
    expect(posts[0]!.excerpt).toBe(
      'A luminous synthetic harbor scene balancing warm lamplight against a cool violet sky.'
    )
    expect(posts[0]!.sourceAttribution).toBe(
      'Imaginaria Vestal (Fictional, 1850–1920)'
    )
    // 102 has neither short_description nor artist — excerpt derives from the
    // description text; attribution falls back to the museum.
    expect(posts[1]!.excerpt).toContain('A quiet monochrome study')
    expect(posts[1]!.sourceAttribution).toBe('Art Institute of Chicago')
  })

  it('flattens multi-line artist_display (real AIC data has embedded newlines)', async () => {
    const { posts } = await load()
    // 108's artist_display is "…Painter\nTesthens, active 500s BCE".
    expect(posts[2]!.sourceAttribution).toBe(
      'Attributed to the Fictional Games Painter, Testhens, active 500s BCE'
    )
    expect(posts[2]!.body).toContain(
      '- **Artist:** Attributed to the Fictional Games Painter, Testhens, active 500s BCE'
    )
  })

  it('supports a .jsonl source identically to a dump directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'demo-data-jsonl-'))
    const files = (await readdir(fixturesDir))
      .filter((f) => f.endsWith('.json'))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    const lines: string[] = []
    for (const file of files) {
      const raw = await readFile(path.join(fixturesDir, file), 'utf8')
      try {
        lines.push(JSON.stringify(JSON.parse(raw)))
      } catch {
        lines.push(raw.replaceAll('\n', ' ').trim()) // 107: an invalid line
      }
    }
    const jsonl = path.join(dir, 'artworks.jsonl')
    await writeFile(jsonl, lines.join('\n') + '\n', 'utf8')

    const dataset = createAicPack({ source: jsonl }).load()
    const posts = await collectPosts(dataset)
    expect(posts.map((p) => p.id)).toEqual(['101', '102', '108', '110'])
    expect(dataset.stats()).toEqual({
      scanned: 11,
      loaded: 4,
      skipped: {
        invalid: 2,
        notPublicDomain: 1,
        noImage: 1,
        noText: 2,
        noDate: 1
      }
    })
  })

  it('size-caps a single record read and counts it as invalid', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'demo-data-cap-'))
    const record = {
      id: 1,
      title: 'Oversized',
      is_public_domain: true,
      image_id: 'cap-test',
      description: `<p>${'x'.repeat(2000)}</p>`,
      date_start: 1900,
      date_end: 1900
    }
    await writeFile(path.join(dir, '1.json'), JSON.stringify(record), 'utf8')
    const dataset = createAicPack({ source: dir, maxRecordBytes: 500 }).load()
    const posts = await collectPosts(dataset)
    expect(posts).toEqual([])
    expect(dataset.stats().skipped).toEqual({ invalid: 1 })
  })

  it('URL-encodes a hostile image_id instead of splicing it into the IIIF path', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'demo-data-hostile-'))
    const record = {
      id: 1,
      title: 'Hostile Image Id',
      is_public_domain: true,
      image_id: ' ../evil/id?x=1#frag ',
      description: '<p>A synthetic record with a path-traversal image_id.</p>',
      date_start: 1900,
      date_end: 1900
    }
    await writeFile(path.join(dir, '1.json'), JSON.stringify(record), 'utf8')
    const posts = await collectPosts(createAicPack({ source: dir }).load())
    const url = posts[0]!.image!.urlForWidth(843)
    expect(url).toBe(
      `${AIC_IIIF_BASE}/${encodeURIComponent('../evil/id?x=1#frag')}/full/843,/0/default.jpg`
    )
    expect(url).not.toContain('/../')
    expect(new URL(url).hash).toBe('')
    expect(new URL(url).pathname.endsWith('/full/843,/0/default.jpg')).toBe(
      true
    )
  })

  it('stops early on limit and reports honest partial stats', async () => {
    const dataset = createAicPack({ source: fixturesDir }).load({ limit: 2 })
    const posts = await collectPosts(dataset)
    expect(posts.map((p) => p.id)).toEqual(['101', '102'])
    const stats = dataset.stats()
    expect(stats.loaded).toBe(2)
    expect(stats.scanned).toBe(
      stats.loaded + Object.values(stats.skipped).reduce((a, b) => a + b, 0)
    )
  })

  it('aborts iteration when the signal fires', async () => {
    const controller = new AbortController()
    const dataset = createAicPack({ source: fixturesDir }).load({
      signal: controller.signal
    })
    await expect(async () => {
      for await (const post of dataset.posts) {
        void post
        controller.abort()
      }
    }).rejects.toThrow()
  })
})

describe('createAicPack relaxed text tier (#512 relaxText)', () => {
  const loadRelaxed = async () => {
    const pack = createAicPack({ source: fixturesDir, textTier: 'relaxed' })
    const dataset = pack.load()
    const posts = await collectPosts(dataset)
    return { posts, stats: dataset.stats() }
  }

  it('admits short-description-only records on top of the strict yield', async () => {
    const { posts, stats } = await loadRelaxed()
    expect(posts.map((p) => p.id)).toEqual(['101', '102', '108', '110', '111'])
    expect(stats).toEqual({
      scanned: 11,
      loaded: 5,
      skipped: {
        invalid: 2,
        notPublicDomain: 1,
        noImage: 1,
        noText: 1, // 105 still has NO text at any tier — stays skipped
        noDate: 1
      }
    })
  })

  it('builds an honest labeled body from the short description, keeping details and attribution', async () => {
    const { posts } = await loadRelaxed()
    const relaxed = posts.find((p) => p.id === '111')!
    expect(relaxed.body).toContain('A short but real curator note')
    expect(relaxed.body).toContain(AIC_RELAXED_BODY_NOTE)
    expect(relaxed.body).toContain('- **Artist:** Testly Draughtsman')
    expect(relaxed.body).toContain('https://www.artic.edu/artworks/111')
    expect(relaxed.body).toContain(
      '[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)'
    )
    expect(relaxed.excerpt).toContain('A short but real curator note')
  })

  it('leaves full-description records byte-identical to the strict tier', async () => {
    const strict = await load()
    const { posts } = await loadRelaxed()
    for (const post of strict.posts) {
      const relaxedTwin = posts.find((p) => p.id === post.id)!
      expect(relaxedTwin.body).toBe(post.body)
      expect(relaxedTwin.excerpt).toBe(post.excerpt)
    }
  })

  it('never labels a full-description body as generated', async () => {
    const { posts } = await loadRelaxed()
    for (const post of posts.filter((p) => p.id !== '111'))
      expect(post.body).not.toContain(AIC_RELAXED_BODY_NOTE)
  })
})
