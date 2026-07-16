/** Bounded sampler against the public AIC API — for smokes and the opt-in online
 *  test, NOT for bulk seeding (AIC's docs point bulk consumers at the data dumps;
 *  the API is rate-limited for anonymous use). Writes records to a `.jsonl` file
 *  in the exact bare-record shape the dump uses, so the pack consumes both
 *  identically. Keyless; goes through core's SSRF-hardened `safeFetch`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeFetch } from '@setu/core'
import { nodeResolveHost } from './fetch-dump'

export const AIC_API_ARTWORKS_URL = 'https://api.artic.edu/api/v1/artworks'

/** Fields the pack consumes (see ./schema.ts) — keeps API responses small. */
const SAMPLE_FIELDS = [
  'id',
  'title',
  'is_public_domain',
  'image_id',
  'description',
  'short_description',
  'artist_display',
  'artist_title',
  'date_display',
  'date_start',
  'date_end',
  'medium_display',
  'dimensions',
  'credit_line',
  'place_of_origin',
  'department_title',
  'classification_title',
  'classification_titles',
  'term_titles',
  'material_titles',
  'thumbnail',
  'updated_at',
  'source_updated_at'
]

export interface FetchAicSampleOptions {
  /** Total records to pull. Default 200. */
  count?: number
  /** Records per API page (AIC caps `limit` at 100). Default 100. */
  pageSize?: number
  /** Pause between pages — stays well inside anonymous rate limits. Default 1.2s. */
  delayMs?: number
  /** Injectable fetch (tests). */
  fetchImpl?: typeof fetch
  /** Injectable DNS resolver (tests). Default: Node dns.lookup. */
  resolveHost?: (hostname: string) => Promise<string[]>
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export async function fetchAicSample(
  destFile: string,
  options: FetchAicSampleOptions = {}
): Promise<{ written: number }> {
  const {
    count = 200,
    pageSize = 100,
    delayMs = 1200,
    fetchImpl,
    resolveHost = nodeResolveHost
  } = options

  const lines: string[] = []
  const pages = Math.ceil(count / Math.min(count, pageSize))
  for (let page = 1; page <= pages && lines.length < count; page++) {
    if (page > 1) await sleep(delayMs)
    const url = new URL(AIC_API_ARTWORKS_URL)
    url.searchParams.set('page', String(page))
    url.searchParams.set('limit', String(Math.min(pageSize, count)))
    url.searchParams.set('fields', SAMPLE_FIELDS.join(','))
    const res = await safeFetch(url, undefined, { fetchImpl, resolveHost })
    if (!res.ok)
      throw new Error(
        `AIC API sample failed: HTTP ${res.status} on page ${page}`
      )
    const payload = JSON.parse(res.text()) as { data?: unknown[] }
    const records = payload.data ?? []
    if (records.length === 0) break
    for (const record of records) {
      if (lines.length >= count) break
      lines.push(JSON.stringify(record))
    }
  }

  await mkdir(path.dirname(destFile), { recursive: true })
  await writeFile(
    destFile,
    lines.join('\n') + (lines.length ? '\n' : ''),
    'utf8'
  )
  return { written: lines.length }
}
