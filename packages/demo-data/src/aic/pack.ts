/** Art Institute of Chicago content pack (#511) — dump-based harvest.
 *
 *  Source facts (all verified 2026-07-16, CLAUDE.md card #9):
 *  - Nightly/monthly data dumps: https://github.com/art-institute-of-chicago/api-data
 *    → full tarball https://artic-api-data.s3.amazonaws.com/artic-api-data.tar.bz2
 *    (~115 MiB compressed; `json/artworks/` alone is 134,078 files / ~1 GB). AIC's
 *    API docs (https://api.artic.edu/docs/) point bulk consumers at the dumps
 *    instead of paging the API.
 *  - Dump files are BARE artwork records: `artic-api-data/json/artworks/{id}.json`.
 *    (`getting-started/allArtworks.jsonl` carries only 5 key fields — id, title,
 *    main_reference_number, department_title, artist_title — so it is NOT usable
 *    as pack input; verified by sampling the file.)
 *  - Licensing (API `info.license_text`, quoted): "The `description` field in this
 *    response is licensed under a Creative Commons Attribution 4.0 Generic License
 *    (CC-By) ... All other data in this response is licensed under a Creative
 *    Commons Zero (CC0) 1.0 designation and the Terms and Conditions of artic.edu."
 *  - IIIF Image API 2.0: `{iiif_url}/{image_id}/full/{width},/0/default.jpg` with
 *    `config.iiif_url = https://www.artic.edu/iiif/2`; the docs recommend width 843
 *    ("the most common size used by our website") — arbitrary widths are valid.
 *  - Images: only `is_public_domain === true` artworks are used, per the epic's
 *    licensing gate; their imagery is public domain per AIC's open-access policy.
 */
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type {
  ContentPack,
  PackDataset,
  PackImageRef,
  PackLoadOptions,
  PackPost,
  PackStats
} from '../contract'
import { htmlToMarkdown, htmlToText } from './html-to-markdown'
import { rawArtworkSchema, type RawArtwork } from './schema'

export const AIC_IIIF_BASE = 'https://www.artic.edu/iiif/2'
export const AIC_ARTWORK_PAGE_BASE = 'https://www.artic.edu/artworks'
/** Cap on a single source record read — a hostile/corrupt multi-MB record is
 *  skipped (counted `invalid`), never buffered. Real records are a few KB. */
export const AIC_MAX_RECORD_BYTES = 4 * 1024 * 1024

/** Skip-reason counters this pack reports in `PackStats.skipped`. */
export const AIC_SKIP_REASONS = [
  'invalid',
  'notPublicDomain',
  'noImage',
  'noText',
  'noDate'
] as const
export type AicSkipReason = (typeof AIC_SKIP_REASONS)[number]

export interface AicPackOptions {
  /** Path to EITHER a directory of per-artwork `{id}.json` files (the extracted
   *  dump's `json/artworks/`) OR a `.jsonl` file (one record per line — the shape
   *  `fetchAicSample` writes). Both are streamed, never buffered whole. */
  source: string
  /** Per-record byte cap (tests shrink it). Default {@link AIC_MAX_RECORD_BYTES}. */
  maxRecordBytes?: number
}

const EXCERPT_MAX = 300

interface RawEntry {
  /** Parsed JSON value, or undefined when unreadable/oversized/unparseable. */
  value?: unknown
}

/** Stream raw entries from a dump directory: `{id}.json` files in numeric id
 *  order (deterministic — readdir order is not guaranteed). */
async function* readDumpDirectory(
  dir: string,
  maxRecordBytes: number
): AsyncGenerator<RawEntry> {
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.json'))
    .sort(
      // Codepoint tiebreak, NOT localeCompare — locale collation varies across
      // machines and would break cross-machine determinism.
      (a, b) =>
        Number.parseInt(a, 10) - Number.parseInt(b, 10) || (a < b ? -1 : 1)
    )
  for (const file of files) {
    const filePath = path.join(dir, file)
    try {
      const { size } = await stat(filePath)
      if (size > maxRecordBytes) {
        yield {}
        continue
      }
      yield { value: JSON.parse(await readFile(filePath, 'utf8')) as unknown }
    } catch {
      yield {}
    }
  }
}

/** Stream raw entries from a .jsonl file, one record per line, capped per line. */
async function* readJsonl(
  file: string,
  maxRecordBytes: number
): AsyncGenerator<RawEntry> {
  const rl = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity
  })
  for await (const line of rl) {
    if (line.trim() === '') continue
    if (Buffer.byteLength(line, 'utf8') > maxRecordBytes) {
      yield {}
      continue
    }
    try {
      yield { value: JSON.parse(line) as unknown }
    } catch {
      yield {}
    }
  }
}

const nonEmpty = (s: string | null | undefined): string | undefined => {
  const t = s?.trim()
  return t ? t : undefined
}

/** Real AIC display fields embed newlines (e.g. artist_display
 *  "George Baxter\nEnglish, 1804-1867" — observed in the live dump). Flatten to
 *  one line for single-line contexts (attribution, detail-list values, title). */
const singleLine = (s: string): string =>
  s
    .replace(/\s*\n+\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()

/** Dedupe case-insensitively, keeping first occurrence's casing and order. */
function dedupeTerms(
  terms: ReadonlyArray<string | null | undefined>
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of terms) {
    const term = nonEmpty(raw ?? undefined)
    if (!term) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(term)
  }
  return out
}

/** Post date: completion year (date_end, else date_start) mapped to Jan 1 UTC when
 *  it fits the honest 1..9999 ISO range; else the record's source timestamps. */
function deriveDate(rec: RawArtwork): string | undefined {
  const year = rec.date_end ?? rec.date_start
  if (typeof year === 'number' && year >= 1 && year <= 9999) {
    // setUTCFullYear, not Date.UTC(year, …): Date.UTC maps years 1..99 to
    // 1901..1999 (the JS two-digit-year rule), which would fabricate
    // 20th-century dates for ancient art.
    const d = new Date(0)
    d.setUTCFullYear(year, 0, 1)
    return d.toISOString()
  }
  for (const ts of [rec.source_updated_at, rec.updated_at]) {
    if (!ts) continue
    const parsed = new Date(ts)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return undefined
}

function buildExcerpt(rec: RawArtwork, descriptionText: string): string {
  const short = nonEmpty(
    rec.short_description && htmlToText(rec.short_description)
  )
  if (short) return short
  if (descriptionText.length <= EXCERPT_MAX) return descriptionText
  const cut = descriptionText.slice(0, EXCERPT_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > EXCERPT_MAX / 2 ? cut.slice(0, lastSpace) : cut) + '…'
}

/** Body = real fields only: the CC-BY description as markdown, a details list of
 *  factual display fields, then the source link + license attribution the AIC
 *  license text requires (description is CC BY 4.0 © Art Institute of Chicago). */
function buildBody(rec: RawArtwork, descriptionMarkdown: string): string {
  const details = (
    [
      ['Artist', rec.artist_display],
      ['Date', rec.date_display],
      ['Medium', rec.medium_display],
      ['Dimensions', rec.dimensions],
      ['Place of origin', rec.place_of_origin],
      ['Credit line', rec.credit_line]
    ] as const
  )
    .map(([label, value]) => {
      const v = nonEmpty(value)
      return v ? `- **${label}:** ${singleLine(v)}` : undefined
    })
    .filter((line): line is string => line !== undefined)

  const attribution =
    `Source: [${rec.title} — Art Institute of Chicago](${AIC_ARTWORK_PAGE_BASE}/${rec.id}). ` +
    'Artwork data licensed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). ' +
    'Description © Art Institute of Chicago, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).'

  return [
    descriptionMarkdown,
    details.length > 0 ? details.join('\n') : undefined,
    '---',
    attribution
  ]
    .filter((part): part is string => part !== undefined)
    .join('\n\n')
}

function buildImage(rec: RawArtwork): PackImageRef {
  // Caller guarantees presence; encode so a hostile image_id can never splice
  // path segments or a query/fragment into the IIIF URL.
  const imageId = encodeURIComponent(rec.image_id!.trim())
  const thumbWidth = rec.thumbnail?.width
  const thumbHeight = rec.thumbnail?.height
  return {
    license:
      'Public-domain artwork (CC0 image per AIC open access; pack filters on is_public_domain)',
    maxWidth:
      typeof thumbWidth === 'number' && thumbWidth > 0 ? thumbWidth : undefined,
    maxHeight:
      typeof thumbHeight === 'number' && thumbHeight > 0
        ? thumbHeight
        : undefined,
    alt: nonEmpty(rec.thumbnail?.alt_text),
    urlForWidth: (width: number) =>
      `${AIC_IIIF_BASE}/${imageId}/full/${Math.max(1, Math.round(width))},/0/default.jpg`
  }
}

/** Normalize one raw entry → a post, or a counted skip reason. */
function normalize(
  entry: RawEntry
): { post: PackPost } | { skip: AicSkipReason } {
  if (entry.value === undefined) return { skip: 'invalid' }
  const parsed = rawArtworkSchema.safeParse(entry.value)
  if (!parsed.success) return { skip: 'invalid' }
  const rec = parsed.data
  if (rec.is_public_domain !== true) return { skip: 'notPublicDomain' }
  if (!nonEmpty(rec.image_id)) return { skip: 'noImage' }
  const descriptionText = rec.description ? htmlToText(rec.description) : ''
  if (descriptionText === '' || !nonEmpty(rec.title)) return { skip: 'noText' }
  const date = deriveDate(rec)
  if (date === undefined) return { skip: 'noDate' }

  const post: PackPost = {
    id: String(rec.id),
    title: singleLine(rec.title),
    body: buildBody(rec, htmlToMarkdown(rec.description!)),
    excerpt: buildExcerpt(rec, descriptionText),
    date,
    sourceAttribution: singleLine(
      nonEmpty(rec.artist_display) ??
        nonEmpty(rec.artist_title) ??
        'Art Institute of Chicago'
    ),
    terms: {
      categories: dedupeTerms([rec.department_title, rec.classification_title]),
      tags: dedupeTerms([
        ...(rec.term_titles ?? []),
        ...(rec.material_titles ?? [])
      ]).slice(0, 12)
    },
    image: buildImage(rec)
  }
  return { post }
}

export function createAicPack(options: AicPackOptions): ContentPack {
  const maxRecordBytes = options.maxRecordBytes ?? AIC_MAX_RECORD_BYTES

  return {
    meta: {
      id: 'aic',
      name: 'Art Institute of Chicago',
      sourceUrl: 'https://api.artic.edu/docs/',
      license:
        'Data CC0 1.0; `description` field CC BY 4.0 (© Art Institute of Chicago); ' +
        'images limited to public-domain artworks (is_public_domain filter).'
    },

    load(loadOptions: PackLoadOptions = {}): PackDataset {
      const skipped: Record<AicSkipReason, number> = {
        invalid: 0,
        notPublicDomain: 0,
        noImage: 0,
        noText: 0,
        noDate: 0
      }
      let scanned = 0
      let loaded = 0

      async function* posts(): AsyncGenerator<PackPost> {
        const { limit, signal } = loadOptions
        if (limit !== undefined && limit <= 0) return
        const sourceStat = await stat(options.source)
        const entries = sourceStat.isDirectory()
          ? readDumpDirectory(options.source, maxRecordBytes)
          : readJsonl(options.source, maxRecordBytes)
        for await (const entry of entries) {
          signal?.throwIfAborted()
          scanned++
          const result = normalize(entry)
          if ('skip' in result) {
            skipped[result.skip]++
            continue
          }
          loaded++
          yield result.post
          if (limit !== undefined && loaded >= limit) return
        }
      }

      return {
        posts: posts(),
        stats(): PackStats {
          // Report only reasons that actually occurred — keeps stats honest and
          // stable if reasons are added later.
          const observed: Record<string, number> = {}
          for (const reason of AIC_SKIP_REASONS)
            if (skipped[reason] > 0) observed[reason] = skipped[reason]
          return { scanned, loaded, skipped: observed }
        }
      }
    }
  }
}
