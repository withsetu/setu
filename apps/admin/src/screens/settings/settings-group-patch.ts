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
 * group, so the salvaged values win every spread (measured on #937: 11 test failures).
 *
 * It deliberately does NOT tidy: a rejected value the admin did not touch is left byte-identical,
 * because the honest response to it is a warning (#953), not a silent rewrite.
 *
 * ## Shape coverage, and why `email` is not here
 *
 * The recursion below covers all four shapes the five groups have — flat fields (`general`,
 * `media`), fixed nested sub-groups (`reading.feed`, `reading.sitemap`, …), open-keyed maps
 * (`permalinks.patterns`) and arrays (`identity.socialProfiles`) — because "diff this object
 * key-by-key, recursing into nested objects" is the same operation for a fixed sub-group and for a
 * map, and an array is a value compared whole.
 *
 * `email` keeps its own patcher ({@link ./email-settings-patch.patchEmailGroup}) because one of its
 * fields is NOT diffable this way: a `templates` ENTRY is an ATOM whose identity is its three known
 * fields (`subject`/`html`/`text`) and which is REPLACED WHOLE when they change, unknown
 * passthrough fields included. Recursing into an entry instead would merge the editor's entry into
 * a stored one the salvage layer had rejected whole; that difference is pinned on both sides —
 * apps/admin/test/email-settings-patch.test.ts ("customizing an id whose stored entry salvage
 * rejected replaces the stored entry, unknown fields included") is the case this file's recursion
 * would answer differently, and apps/admin/test/settings-group-patch.test.ts ("editing one
 * collection keeps a stored pattern that failed validation") is the map case the two agree on.
 * Generalizing across that boundary would mean an "atomic key" option, i.e. two behaviors behind
 * one name.
 */

type Rec = Record<string, unknown>

const isPlainObject = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Structural comparison, used for the dirty DECISION on one key. Deliberately not a general-purpose
 * deep-equal: it handles exactly what a parsed settings value can be — JSON primitives, arrays and
 * plain objects — and answers `false` for anything else it cannot look inside (a Date, a Map),
 * which errs towards WRITING the key rather than silently keeping a stale one.
 */
const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => k in b && sameValue(a[k], b[k]))
    )
  }
  return false
}

/**
 * The patched record, or null when nothing under it changed — in which case the caller leaves
 * whatever is stored (including a non-object, or an entry the salvage layer rejected) exactly as
 * it is.
 *
 * The recursion walks `published`/`next`, never `raw`, so its depth is the depth of the group's
 * own type rather than anything an arriving file controls.
 */
function patchRecord(raw: unknown, published: Rec, next: Rec): Rec | null {
  const out: Rec = isPlainObject(raw) ? { ...raw } : {}
  let changed = false
  // A key that was published and is now gone is a deliberate delete — a permalink pattern reset to
  // the default scheme, which has to reach Git or "back to Plain" would never stick.
  for (const key of Object.keys(published))
    if (!(key in next)) {
      delete out[key]
      changed = true
    }
  for (const [key, nextValue] of Object.entries(next)) {
    const publishedValue = published[key]
    if (isPlainObject(publishedValue) && isPlainObject(nextValue)) {
      const nested = patchRecord(out[key], publishedValue, nextValue)
      if (nested !== null) {
        out[key] = nested
        changed = true
      }
      continue
    }
    if (!sameValue(publishedValue, nextValue)) {
      out[key] = nextValue
      changed = true
    }
  }
  return changed ? out : null
}

/**
 * The `<group>` value to commit: `rawGroup` with the admin's changes applied.
 *
 * `published` is what the screen loaded (the salvaged reading), `next` is what it is saving. A
 * non-object `rawGroup` is replaced by the patch alone rather than spread, since there is nothing
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
      next as unknown as Rec
    ) ?? (isPlainObject(rawGroup) ? { ...rawGroup } : {})
  )
}
