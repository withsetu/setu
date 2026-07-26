/**
 * #956: build the settings group to COMMIT, by patching the raw stored group with what the admin
 * actually changed — never by writing back the group the screen loaded.
 *
 * Every settings screen loads `parseSettings(raw).<group>`, which is the SALVAGED reading: a value
 * the salvage layer rejected has already been replaced by a default (`media.imageFormat: "nope"`,
 * `identity.entityType: "robot"`, `reading.feed.items: "many"`) or dropped
 * (`permalinks.patterns.<collection>` failing `validatePermalinkPattern`) by the time the screen
 * sees it. Writing that reading back as the whole group therefore ERASED every one of those stored
 * values — from Git, the canonical store — as a side effect of an unrelated edit on the same
 * screen, under a "Settings saved" toast. settings.json is Git-canonical, so those values are not
 * hypothetical: they arrive by `git push` and from a newer build's fields.
 *
 * The rule is per-FIELD, applied recursively: a key is written only when its value differs from
 * what was published. That is what makes "unrelated" mean unrelated — a naive merge of the salvaged
 * group over `raw.<group>` is NOT enough, because each screen owns all the known fields of its
 * group, so the salvaged values win every spread (measured on #937: 11 test failures; re-measured
 * for #956, where the naive merge fails the same 22 tests at the same 22 line numbers as no fix at
 * all — an identical failure SET, not merely an identical count).
 *
 * ## Shape coverage — all six groups, including `email`
 *
 * The recursion covers every shape the settings groups have: flat fields (`general`, `media`),
 * fixed nested sub-groups (`reading.feed`, `reading.sitemap`, …), open-keyed maps
 * (`permalinks.patterns`, `email.templates`) and arrays (`identity.socialProfiles`) — because
 * "diff this object key-by-key, recursing into nested objects" is the same operation for a fixed
 * sub-group and for a map, and an array is a value compared whole.
 *
 * **`email` used to have its own patcher, and the argument for keeping it was wrong** (#978 review
 * F2). `patchEmailGroup` treated a `templates` ENTRY as an ATOM — replaced whole when its three
 * known fields changed — justified by the case where salvage rejects an entry WHOLE. That case
 * does not distinguish the two rules at all: a rejected-whole entry is `undefined` in `published`,
 * so there is no object pair to recurse into and the generic rule also replaces whole (measured:
 * byte-identical output). The two rules diverge on exactly one case, the HOLLOWED entry — a known
 * field dropped field-wise while the entry stays under the size cap — and there the atom rule
 * DROPPED the rejected field when the admin edited a different field of the same entry. That is
 * #956's own defect, one level deeper, so the generic rule is not merely equivalent here, it is
 * the correct one. `patchEmailGroup` is now a thin wrapper over this function; the divergent case
 * is pinned by apps/admin/test/email-settings-patch.test.ts ("an over-cap template body survives
 * an edit to a DIFFERENT field of the same entry").
 *
 * ## Caller precondition — a key missing from `next` is a DELETE
 *
 * `next` must carry every key of `published` the caller does not intend to remove. A key present in
 * `published` and absent from `next` is written as a deliberate deletion, **at every level
 * including the group's top level** — not only inside the open-keyed maps where the feature is
 * wanted. So a caller that rebuilds `next` field-by-field (`{ patterns, uncategorized }`) rather
 * than spreading what it loaded will silently delete every unknown passthrough field a newer build
 * stored. `PermalinksSettings` had exactly that bug; pinned by
 * apps/admin/test/permalinks-settings.test.tsx ("an unknown field inside the permalinks group
 * survives a pattern edit").
 *
 * ## What it does NOT do
 *
 * It does not tidy: a rejected value the admin did not touch is left byte-identical, because the
 * honest response to it is a warning (#953), not a silent rewrite. Two reachable exceptions, both
 * consequences of writing a whole VALUE rather than merging into it, and both pinned by
 * apps/admin/test/settings-group-patch.test.ts ("the documented exceptions to not tidying"):
 *
 *  1. a stored sub-group that is not an object (`reading.feed: "yes"`) is replaced by the patch as
 *     soon as anything inside that sub-group changes — there is no object to merge into, so the
 *     junk goes with the write;
 *  2. an array is compared and written WHOLE, so `identity.socialProfiles` loses the non-string
 *     members salvage filtered out as soon as the admin edits any row of it.
 */

type Rec = Record<string, unknown>

const isPlainObject = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Recursion budget for {@link patchRecord} and {@link sameValue} (#978 review F1).
 *
 * Needed because the depth of these walks IS attacker-controlled, which the comment here used to
 * deny: `salvageGroup` passes an unknown key through untouched (packages/core/src/settings/
 * schema.ts) without recursing into it, so `published.<group>.futureField` is the arriving file's
 * own object at the file's own depth, and every screen carries it into `next`. This patcher is the
 * first thing in the load→save path that actually walks that depth. `JSON.parse` is iterative and
 * happily accepts 100,000 levels; unbounded, these two functions overflow the stack at ~4,000.
 *
 * 64 is ~30x the deepest nesting any settings group defines (`reading.feed.enabled` is 2) and two
 * orders of magnitude below the overflow. Past the budget the pair is treated as an opaque value:
 * `sameValue` answers `false` and the key is written WHOLE from `next`. That is lossless in the
 * realistic case — an untouched passthrough subtree in `next` is the same object `raw` holds, so
 * writing it back is byte-identical — and it degrades to "write what the admin has" rather than to
 * a thrown `RangeError` in the middle of a save. Pinned by
 * apps/admin/test/settings-group-patch.test.ts ("survives a passthrough field nested far deeper
 * than any group defines").
 */
const MAX_PATCH_DEPTH = 64

/**
 * Structural comparison, used for the dirty DECISION on one key. Deliberately not a general-purpose
 * deep-equal: it handles exactly what a parsed settings value can be — JSON primitives, arrays and
 * plain objects — and answers `false` for anything else it cannot look inside (a Date, a Map, or a
 * pair deeper than {@link MAX_PATCH_DEPTH}), which errs towards WRITING the key rather than
 * silently keeping a stale one.
 */
const sameValue = (a: unknown, b: unknown, depth: number): boolean => {
  if (a === b) return true
  if (depth >= MAX_PATCH_DEPTH) return false
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((x, i) => sameValue(x, b[i], depth + 1))
    )
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => k in b && sameValue(a[k], b[k], depth + 1))
    )
  }
  return false
}

/**
 * The patched record, or null when nothing under it changed — in which case the caller leaves
 * whatever is stored (including a non-object, or an entry the salvage layer rejected) exactly as
 * it is.
 *
 * The recursion is bounded by {@link MAX_PATCH_DEPTH} because its depth is NOT fixed by the group's
 * type — see that constant for why.
 */
function patchRecord(
  raw: unknown,
  published: Rec,
  next: Rec,
  depth: number
): Rec | null {
  const out: Rec = isPlainObject(raw) ? { ...raw } : {}
  let changed = false
  // A key that was published and is now gone is a deliberate delete. Wanted for an open-keyed map
  // (a permalink pattern reset to the default scheme, a template reset to the shipped one, both of
  // which have to reach Git or "reset" would never stick) — but it applies at EVERY level, which
  // is a precondition on the caller. See the module docblock.
  for (const key of Object.keys(published))
    if (!(key in next)) {
      delete out[key]
      changed = true
    }
  for (const [key, nextValue] of Object.entries(next)) {
    const publishedValue = published[key]
    if (
      depth < MAX_PATCH_DEPTH &&
      isPlainObject(publishedValue) &&
      isPlainObject(nextValue)
    ) {
      const nested = patchRecord(out[key], publishedValue, nextValue, depth + 1)
      if (nested !== null) {
        out[key] = nested
        changed = true
      }
      continue
    }
    if (!sameValue(publishedValue, nextValue, depth)) {
      out[key] = nextValue
      changed = true
    }
  }
  return changed ? out : null
}

/**
 * The `<group>` value to commit: `rawGroup` with the admin's changes applied.
 *
 * `published` is what the screen loaded (the salvaged reading), `next` is what it is saving. Read
 * the module docblock's caller precondition before adding a call site: a key missing from `next`
 * deletes it from Git.
 *
 * A non-object `rawGroup` is replaced by the patch alone rather than spread, since there is nothing
 * in it to preserve — pinned by apps/admin/test/settings-group-patch.test.ts ("a non-object stored
 * group is replaced by the patch alone, never spread").
 */
export function patchSettingsGroup<T extends object>(
  rawGroup: unknown,
  published: T,
  next: T
): Rec {
  return (
    patchRecord(
      rawGroup,
      published as unknown as Rec,
      next as unknown as Rec,
      0
    ) ?? (isPlainObject(rawGroup) ? { ...rawGroup } : {})
  )
}
