/** Normalize a raw tag to its canonical lowercase form: lowercase, trim, drop
 *  punctuation, spaces/underscores → hyphens, collapse repeats, strip edges.
 *  Returns '' for empty/symbol-only input (callers reject ''). */
export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Normalize a list of raw tags: drop empties, dedupe preserving first-seen order. */
export function normalizeTags(raw: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    const t = normalizeTag(r)
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}
