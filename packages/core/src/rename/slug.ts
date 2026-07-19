/** THE entry-slug vocabulary — shared by minting (admin compose), validation
 *  (rename service), and auto-derive, so any slug the system can mint is also
 *  renameable-to and vice versa. Distinct from the taxonomy slugify
 *  (`taxonomy/ops.ts`), which has different fallback semantics.
 *
 *  Title/slug text → URL-safe entry slug. Lowercase — Unicode letters are KEPT
 *  (`Über uns` → `über-uns`), words joined by single hyphens; drops punctuation.
 *  Returns '' for empty/symbol-only input (callers fall back to 'untitled').
 *
 *  Entry slugs are UNICODE-PRESERVING, not ASCII-folded like the sibling `mediaSlug`
 *  (image/media-key.ts), and that difference is deliberate: a media slug names an opaque storage
 *  key nobody reads, while an entry slug IS the published URL, so ASCII-folding it would turn
 *  every Japanese, Greek or Arabic post into `untitled` — an i18n regression, not a hardening.
 *  The input is NFKC-normalized so the SAME title always mints the SAME slug regardless of how
 *  it was typed, pasted or normalized on the way in (#669). */
export function entrySlugify(text: string): string {
  return (
    // #669: normalize FIRST. Without this the same title minted two different slugs — and
    // therefore two different published URLs — depending on whether it arrived composed (NFC)
    // or decomposed (NFD): 'Café' NFC gave 'café', the NFD spelling macOS pastes and Safari
    // routinely produce gave 'cafe', because the combining acute is a \p{M} the filter drops.
    // NFKC rather than NFC: it also maps the compatibility characters (`ﬁ`→`fi`, `ſ`→`s`,
    // `Ⅻ`→`XII`, `µ`→`μ`) onto their expansions, so one spelling of a name cannot
    // masquerade as another. The sibling `mediaSlug` has always normalized (NFKD); this closes
    // the gap the shared docstring wrongly implied was only about fallback semantics.
    text
      .normalize('NFKC')
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '') // keep letters, numbers, whitespace, underscore, hyphen
      .replace(/[\s_]+/g, '-') // whitespace + underscores → hyphen separators
      .replace(/-+/g, '-')
      // Trim edge hyphens with LINEAR patterns: after the collapse above any run
      // is a single char, so `^-`/`-$` suffice — the alternation form
      // (`/^-+|-+$/`) backtracks polynomially on hyphen floods (CodeQL
      // js/polynomial-redos).
      .replace(/^-/, '')
      .replace(/-$/, '')
  )
}

/** Reserved: the admin's compose-route sentinel (`/edit/<c>/<l>/new`) — never a
 *  real entry identity. */
export const RESERVED_ENTRY_SLUG = 'new'

/** A string is a valid entry slug iff it is non-empty, not the reserved compose
 *  sentinel, and already canonical — a fixed point of `entrySlugify`. Validating
 *  by fixed point (instead of an ASCII regex) keeps the vocabulary in ONE place:
 *  anything minting can produce, this accepts. */
export function isValidEntrySlug(slug: string): boolean {
  return (
    slug.length > 0 &&
    slug !== RESERVED_ENTRY_SLUG &&
    entrySlugify(slug) === slug
  )
}
