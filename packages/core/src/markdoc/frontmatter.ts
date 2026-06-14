import { dump, load } from 'js-yaml'

/** A parsed `.mdoc` file: YAML frontmatter (open record) + Markdoc body. */
export interface MdocFile {
  frontmatter: Record<string, unknown>
  body: string
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
      return { frontmatter: data as Record<string, unknown>, body: m[2]! }
    }
  }
  return { frontmatter: {}, body: raw }
}

/** Serialize frontmatter + a Markdoc body into a `.mdoc` file. Empty frontmatter
 *  produces a body-only file (no `---` block) so body-only content round-trips
 *  unchanged. */
export function serializeMdoc({ frontmatter, body }: MdocFile): string {
  if (Object.keys(frontmatter).length === 0) return body
  return `---\n${dump(frontmatter)}---\n${body}`
}
