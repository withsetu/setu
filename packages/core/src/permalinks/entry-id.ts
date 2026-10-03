/**
 * The site's entry identity, derived from a file's path under the content dir.
 *
 * ONE rule, used by both scans that have to agree on it: the Astro content loader's
 * `generateId` (`apps/site/src/content.config.ts`) and the build-time codegen
 * (`scripts/gen-relations.mjs`, which keys `relations.json` and `url-map.json`). Parity of
 * the two over an `index.mdoc`, a frontmatter `slug:` and a mixed-case dotted filename is
 * pinned end to end by apps/site/test/entry-id-parity.test.ts.
 *
 * The rule is **verbatim**: the path relative to the content dir, `/`-separated, minus the
 * `.mdoc` extension — `content/<collection>/<locale>/<slug>.mdoc` → `collection/locale/slug`,
 * the identity `contentPath`/`parseContentPath` already mint and parse. Deliberately NOT
 * Astro's default id:
 *  - frontmatter `slug:` is ignored — it would replace the whole id, dropping collection
 *    and locale (an imported post would vanish from every archive);
 *  - `index.mdoc` stays slug `index` — stripping it would turn `page/en/index.mdoc` into the
 *    two-segment `page/en`, and the admin can mint exactly that file;
 *  - no per-segment slugging — `V1.2-Release.mdoc` is `…/V1.2-Release`, so the id is the
 *    Git path the rest of the system uses, and two files can never fold onto one id.
 * Pure string work: edge-safe.
 */

export const CONTENT_ENTRY_EXTENSION = '.mdoc'

/** Content-dir-relative path → entry id (`collection/locale/slug`). */
export function entryIdFromContentPath(relPath: string): string {
  const posix = relPath.replace(/\\/g, '/')
  return posix.endsWith(CONTENT_ENTRY_EXTENSION)
    ? posix.slice(0, -CONTENT_ENTRY_EXTENSION.length)
    : posix
}

/** Does the site load this content-dir-relative path as an entry? A `.mdoc` file with no
 *  dot-prefixed segment: the loader's `**\/*.mdoc` glob runs with tinyglobby's default
 *  `dot: false`, so a codegen walk that should see the same file set must skip those too. */
export function isSiteEntryPath(relPath: string): boolean {
  const posix = relPath.replace(/\\/g, '/')
  if (!posix.endsWith(CONTENT_ENTRY_EXTENSION)) return false
  return posix.split('/').every((seg) => seg !== '' && !seg.startsWith('.'))
}
