import { dump, load } from 'js-yaml'

/** A parsed `.mdoc` file: YAML frontmatter (open record) + Markdoc body. */
export interface MdocFile {
  frontmatter: Record<string, unknown>
  body: string
  /** The ORIGINAL YAML text of the frontmatter block, exactly as it appeared between
   *  the `---` fences (no trailing newline). Set by `parseMdoc`; carry it back into
   *  `serializeMdoc` and every key the author did not actually change is re-emitted
   *  byte-for-byte (#666). Omit it and you get a clean `dump` of the object, which is
   *  lossy in ways detailed on `serializeMdoc`. */
  rawFrontmatter?: string | undefined
}

const FENCE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/

/** Parse a `.mdoc` file into frontmatter + Markdoc body. A leading `---` block is
 *  treated as frontmatter ONLY when it is a closed fence whose YAML is a plain
 *  object — so a body that starts with `---` (a horizontal rule) is never
 *  mistaken for frontmatter, and malformed/empty YAML falls back to body-only.
 *  Never throws and never drops the body.
 *
 *  Round-trips for all `serializeMdoc` output and for HR-leading bodies. The one
 *  inherently ambiguous input is a body that IS ITSELF a tight, object-shaped
 *  YAML fence (`---\nkey: val\n---\n…`) paired with empty frontmatter — it is
 *  indistinguishable from that fence being real frontmatter. Real publish output
 *  (Markdoc, blank-line-separated) never produces such a body. */
export function parseMdoc(raw: string): MdocFile {
  const m = FENCE.exec(raw)
  if (m) {
    let data: unknown
    try {
      data = load(m[1]!)
    } catch {
      return { frontmatter: {}, body: raw }
    }
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      return {
        frontmatter: data as Record<string, unknown>,
        body: m[2]!,
        rawFrontmatter: m[1]!
      }
    }
  }
  return { frontmatter: {}, body: raw }
}

/** The original frontmatter YAML text of a `.mdoc` source, ready to feed back into
 *  `serializeMdoc` as `rawFrontmatter`. `undefined` when there is no fence (a new
 *  entry, or a body-only file) — exactly the "nothing to retain" case. */
export function rawFrontmatterOf(
  source: string | null | undefined
): string | undefined {
  if (typeof source !== 'string') return undefined
  return parseMdoc(source).rawFrontmatter
}

/** Structural equality with Dates normalized to their ISO string.
 *
 *  The Date normalization is load-bearing: a draft's metadata round-trips through
 *  JSON in the DB, so a YAML `date: 2024-01-01` comes back as the ISO STRING that
 *  `Date.prototype.toJSON` produced. That is not an author edit, so it must not
 *  invalidate the retained raw text. */
function sameValue(a: unknown, b: unknown): boolean {
  const na = a instanceof Date ? a.toISOString() : a
  const nb = b instanceof Date ? b.toISOString() : b
  if (na === nb) return true
  if (typeof na !== 'object' || typeof nb !== 'object') return false
  if (na === null || nb === null) return false
  const aIsArr = Array.isArray(na)
  if (aIsArr !== Array.isArray(nb)) return false
  if (aIsArr) {
    const xa = na as unknown[]
    const xb = nb as unknown[]
    return xa.length === xb.length && xa.every((v, i) => sameValue(v, xb[i]))
  }
  const oa = na as Record<string, unknown>
  const ob = nb as Record<string, unknown>
  const ka = Object.keys(oa)
  if (ka.length !== Object.keys(ob).length) return false
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(ob, k) && sameValue(oa[k], ob[k])
  )
}

/** A top-level key of the raw YAML plus the exact source lines that produced it
 *  (including any comment/blank lines leading it). `key === null` is the trailing
 *  comment/blank tail, which is always re-emitted. */
interface RawBlock {
  key: string | null
  lines: string[]
}

/** A line opening a top-level mapping key: `key:`, `key: value`, or a quoted key.
 *  Deliberately narrow — anything else at column 0 aborts the retention path. */
const KEY_LINE =
  /^([A-Za-z0-9_][\w.$-]*|"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')[ \t]*:([ \t]|$)/

function unquoteKey(k: string): string {
  if (k.startsWith('"')) return JSON.parse(k) as string
  if (k.startsWith("'")) return k.slice(1, -1).replace(/''/g, "'")
  return k
}

/** Split raw frontmatter YAML into per-top-level-key source blocks, preserving every
 *  byte and their order. Returns null for anything this line scanner cannot split
 *  with certainty (top-level sequences, duplicate keys, a flow collection continued
 *  at column 0) — the caller then falls back to a full dump. */
function splitTopLevelBlocks(raw: string): RawBlock[] | null {
  const blocks: RawBlock[] = []
  const seen = new Set<string>()
  let cur: RawBlock | null = null
  let lead: string[] = []

  for (const line of raw.split('\n')) {
    if (line.trim() === '' || /^[ \t]/.test(line)) {
      // Blank or indented: part of the current block. Flushing `lead` here is what
      // keeps a blank line INSIDE a block scalar in its original position.
      if (cur === null) lead.push(line)
      else {
        cur.lines.push(...lead, line)
        lead = []
      }
      continue
    }
    if (line.startsWith('#')) {
      // A column-0 comment leads the NEXT key (or trails the document).
      lead.push(line)
      continue
    }
    const m = KEY_LINE.exec(line)
    if (m === null) return null
    const key = unquoteKey(m[1]!)
    if (seen.has(key)) return null
    seen.add(key)
    if (cur !== null) blocks.push(cur)
    cur = { key, lines: [...lead, line] }
    lead = []
  }
  if (cur !== null) blocks.push(cur)
  if (lead.length > 0) blocks.push({ key: null, lines: lead })
  return blocks
}

/** `dump` one key/value pair as source lines (no trailing blank line). */
function dumpKey(key: string, value: unknown): string[] {
  return dump({ [key]: value })
    .replace(/\n$/, '')
    .split('\n')
}

/** Re-emit frontmatter YAML, reusing the original text for every unchanged key and
 *  dumping only what actually differs. Returns null when retention cannot be done
 *  safely, so the caller falls back to a full `dump`. */
function retainedYaml(
  frontmatter: Record<string, unknown>,
  raw: string
): string | null {
  let parsed: unknown
  try {
    parsed = load(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    return null
  const base = parsed as Record<string, unknown>

  // Nothing changed at all — the overwhelmingly common "opened it and saved" case.
  // Emitting the source verbatim is also the only way anchors and merge keys can
  // survive, since neither has any representation in the loaded object.
  if (sameValue(base, frontmatter)) return raw

  const blocks = splitTopLevelBlocks(raw)
  if (blocks === null) return null

  const out: string[] = []
  const emitted = new Set<string>()
  for (const b of blocks) {
    if (b.key === null) {
      out.push(...b.lines)
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(frontmatter, b.key)) continue
    emitted.add(b.key)
    if (sameValue(base[b.key], frontmatter[b.key])) out.push(...b.lines)
    else out.push(...dumpKey(b.key, frontmatter[b.key]))
  }
  for (const [k, v] of Object.entries(frontmatter)) {
    if (!emitted.has(k)) out.push(...dumpKey(k, v))
  }
  const text = out.join('\n')

  // Backstop: whatever the scanner did, the result MUST re-read as the metadata the
  // caller handed us. If it does not, drop retention entirely rather than write a
  // file whose meaning drifted.
  let check: unknown
  try {
    check = load(text)
  } catch {
    return null
  }
  if (check === null || typeof check !== 'object' || Array.isArray(check))
    return null
  return sameValue(check, frontmatter) ? text : null
}

/** Serialize frontmatter + a Markdoc body into a `.mdoc` file. Empty frontmatter
 *  produces a body-only file (no `---` block) so body-only content round-trips
 *  unchanged.
 *
 *  #666: when `rawFrontmatter` is supplied (from `parseMdoc`/`rawFrontmatterOf`),
 *  keys the caller did not change are re-emitted from the ORIGINAL text. Without it,
 *  a plain `dump` of the loaded object silently rewrites the canonical Git artifact:
 *  `12345678901234567890` loses float64 precision (external IDs corrupt), `1.10`
 *  becomes `1.1`, a bare `2024-01-01` becomes a full timestamp (changing what every
 *  `:year`/`:month` permalink token is fed), quoting style is normalized, comments
 *  vanish, key order is rewritten, and anchors/merge keys are expanded inline. */
export function serializeMdoc({
  frontmatter,
  body,
  rawFrontmatter
}: MdocFile): string {
  if (Object.keys(frontmatter).length === 0) return body
  const retained =
    rawFrontmatter === undefined
      ? null
      : retainedYaml(frontmatter, rawFrontmatter)
  const yaml = retained === null ? dump(frontmatter) : `${retained}\n`
  return `---\n${yaml}---\n${body}`
}
