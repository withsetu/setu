import { normalize, sep } from 'node:path'

/** Drop any run of trailing separators — `/` on every platform, plus the platform's own
 *  `sep` so a win32 `C:\media\` is handled like a POSIX `/var/media/`.
 *
 *  A single linear scan rather than an anchored `[\/\\]+$` regex: the anchored quantifier
 *  form is polynomial because the engine re-tries it from every start position (#340), and
 *  `dir` is operator-supplied (`SETU_MEDIA_DIR`).
 *
 *  Deliberately NOT shared with the `baseUrl` trim in `./index.ts`, which must stay `/`-only:
 *  a backslash is a legal, meaningful character in a URL path. */
function stripTrailingSeparators(s: string, separator: string): string {
  let end = s.length
  while (end > 0) {
    const c = s.charAt(end - 1)
    if (c !== '/' && c !== separator) break
    end--
  }
  return end === s.length ? s : s.slice(0, end)
}

/** The canonical form of `dir` used for every containment comparison: normalized, with any
 *  trailing separator removed, and never the empty string.
 *
 *  `normalize()` keeps a trailing separator, which made `root + sep` end in `//` so every
 *  key failed containment and was reported as a path traversal — total media failure from
 *  `SETU_MEDIA_DIR=/var/media/` (#896). The first fix stripped only `/` and fell back to the
 *  un-stripped `normalize(dir)` when the strip emptied the string, so `dir: '/'` walked
 *  straight back into the same `//`, and no win32 separator was stripped at all (#914).
 *
 *  `separator` is a parameter only so the win32 shape is testable off Windows — see
 *  packages/storage-local/test/root.test.ts, which covers `/`, `///`, a trailing run, and
 *  the backslash form. Windows is not otherwise a supported topology here (no Windows CI). */
export function rootOf(dir: string, separator: string = sep): string {
  const stripped = stripTrailingSeparators(normalize(dir), separator)
  return stripped === '' ? separator : stripped
}

/** The prefix a resolved absolute path must start with to sit strictly inside `root`.
 *  Guards against `root + separator` doubling the separator when `root` already ends in one
 *  (the filesystem root, `'/'`). Covered by packages/storage-local/test/root.test.ts. */
export function rootPrefix(root: string, separator: string = sep): string {
  return root.endsWith(separator) ? root : root + separator
}

/** Whether an already-normalized absolute path is `root` itself or sits inside it.
 *
 *  Lives here, and is unit-tested directly in packages/storage-local/test/root.test.ts,
 *  because `resolveKey` rejects absolute keys and `..` segments before ever calling this —
 *  so no key reaching it through the adapter can fail it, and deleting the call site left
 *  the whole suite green (measured while adding these tests, #914). It stays as defence in
 *  depth for the same reason it can't be exercised end-to-end: it is the backstop if that
 *  earlier guard is ever narrowed. */
export function isInsideRoot(
  root: string,
  abs: string,
  separator: string = sep
): boolean {
  return abs === root || abs.startsWith(rootPrefix(root, separator))
}
