/** THE fold used everywhere a path or slug collision must be judged: the API write gate
 *  (`foldRepoPath` in apps/api/src/app.ts), slug minting/validation below, and the rename
 *  service's `target-exists` guard. ONE definition on purpose — #654 was two halves of the
 *  system disagreeing about what "the same file" means, and a second opinion is a second bug.
 *
 *  It approximates the relation a case-INSENSITIVE filesystem (APFS/NTFS) actually resolves
 *  names by. JS exposes no `toCaseFold()`, but the two mappings it does expose compose into one
 *  strong enough to REJECT with:
 *
 *   - `normalize('NFC')` collapses the composed/decomposed split. `café` written NFC and the same
 *     word written NFD (`e` + U+0301) are ONE file on APFS, which normalizes names before
 *     hashing them.
 *   - `toUpperCase().toLowerCase()` collapses every character whose Unicode case FOLDING differs
 *     from its simple lowercase mapping: `ſ`→`s` (U+017F), `ﬁ`→`fi` (U+FB01), `ß`→`ss`, `ı`→`i`,
 *     `ς`→`σ`. Plain `toLowerCase()` — Unicode SIMPLE CASE MAPPING — leaves every one of those
 *     alone, and that gap is exactly what let a rename silently destroy a published entry (#654)
 *     and what the #647 gate documented as a KNOWN GAP it could not close.
 *
 *  Deliberately allowed to over-fold (`ß` and `strasse` are treated as one name even though APFS
 *  keeps them apart). This value is only ever used to REJECT, never to rewrite a caller's path:
 *  over-folding costs an unusual slug spelling, under-folding costs a published post.
 *
 *  The `ς`→`σ` pass is what makes the result CONTEXT-FREE, and it is load-bearing. JS's
 *  `toLowerCase` implements Unicode's Final_Sigma rule, so `Σ` lowercases to `ς` word-finally and
 *  `σ` elsewhere — which made the fold depend on what followed. Measured: the slug `ελλάς` folded
 *  to itself, but the path `content/blog/el/ελλάς.mdoc` folded to `…ελλάσ.mdoc`, because the
 *  trailing `.mdoc` stops the sigma being word-final. The slug vocabulary would then have minted
 *  a slug whose own content path the API gate rejects. Folding both sigmas to `σ` is also what
 *  Unicode SIMPLE case folding does — the relation APFS actually resolves names by — so this is
 *  the more faithful mapping as well as the stable one. */
export function unicodeCaseFold(s: string): string {
  return s
    .normalize('NFC')
    .toUpperCase()
    .toLowerCase()
    .replace(/ς/g, 'σ') // GREEK SMALL LETTER FINAL SIGMA → SIGMA
    .normalize('NFC')
}

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
 *  What entry slugs give up instead is FOLD-INSTABILITY: the input is NFKC-normalized (so a
 *  compatibility character can never masquerade as its ASCII expansion) and then case-folded via
 *  `unicodeCaseFold`, so every slug this can mint is its own fold. Two distinct valid slugs can
 *  therefore never resolve to the same file on a case-folding filesystem (#654, #669). */
export function entrySlugify(text: string): string {
  return (
    // NFKC first: it maps the compatibility characters that fold into ASCII (`ﬁ`→`fi`,
    // `ſ`→`s`, `Ⅻ`→`XII`, `µ`→`μ`) onto their expansions, so the collision is resolved at
    // MINTING time rather than being detected later. Then `unicodeCaseFold` closes the residue
    // NFKC does not touch (`ß`, `ı`, `ς`) and pins the composed/decomposed spelling (#669: the
    // same title arriving NFD from a macOS paste used to mint a DIFFERENT slug, and therefore a
    // different published URL, than the NFC spelling).
    unicodeCaseFold(text.normalize('NFKC'))
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
 *  anything minting can produce, this accepts.
 *
 *  Since `entrySlugify` now NFKC-normalizes and case-folds, the fixed-point test also carries
 *  the #654 security property for free: a fold-unstable slug (`ﬁle`, `ſettings`, `straße`, an
 *  NFD `café`) is not its own `entrySlugify` output, so it is rejected here — it can never
 *  become an entry identity and therefore can never collide with a published one. */
export function isValidEntrySlug(slug: string): boolean {
  return (
    slug.length > 0 &&
    slug !== RESERVED_ENTRY_SLUG &&
    entrySlugify(slug) === slug
  )
}
