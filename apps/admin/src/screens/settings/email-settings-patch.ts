import type {
  EmailSettings as EmailValues,
  EmailTemplateOverride,
  EmailTemplateOverrides
} from '@setu/core'

/**
 * #937: build the `email` group to COMMIT, by patching the raw stored group with what the admin
 * actually changed — never by writing back the group the screen loaded.
 *
 * Settings → Email loads `parseSettings(raw).email`, which is the SALVAGED reading: an invalid
 * `provider`, an invalid `fromAddress`, a template whose id fails EMAIL_TYPE_ID and an oversized
 * template entry have all already been replaced by defaults or dropped by the time the screen
 * sees them. Writing that reading back as the whole group therefore ERASED every one of those
 * stored values — from Git, the canonical store — as a side effect of an unrelated from-address
 * change, under a "Settings saved" toast. settings.json is Git-canonical, so those values are not
 * hypothetical: they arrive by `git push` and by a plugin whose email type this build has not
 * loaded (#302).
 *
 * The rule here is per-field and, for templates, per-ENTRY: a key is written only when its value
 * differs from what was published. That is what makes "unrelated" mean unrelated — a naive merge
 * over `raw.email` would not have been enough, because the screen owns all three known fields, so
 * the salvaged values would still have won every spread.
 *
 * It deliberately does NOT tidy: a rejected value the admin did not touch is left byte-identical,
 * because the honest response to it is the warning the api and the site build now print (#937's
 * other half), not a silent rewrite. Every branch is pinned by
 * apps/admin/test/email-settings-patch.test.ts.
 */
export function patchEmailGroup(
  rawEmail: unknown,
  published: EmailValues,
  next: EmailValues
): Record<string, unknown> {
  const out: Record<string, unknown> = isPlainObject(rawEmail)
    ? { ...rawEmail }
    : {}
  if (next.fromAddress !== published.fromAddress)
    out.fromAddress = next.fromAddress
  if (next.provider !== published.provider) out.provider = next.provider
  const templates = patchTemplates(
    out.templates,
    published.templates,
    next.templates
  )
  if (templates !== null) out.templates = templates
  return out
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The three fields the template editor can write. Comparing on them (rather than on the whole
 *  object) keeps an entry's unknown passthrough fields out of the dirty decision — they are
 *  carried along untouched either way, since `next`'s entries came from the same salvage that
 *  passed them through. */
const entryKey = (o: EmailTemplateOverride | undefined): string =>
  JSON.stringify([o?.subject ?? null, o?.html ?? null, o?.text ?? null])

/** The patched `templates` value, or null when the admin changed no template — in which case the
 *  caller leaves whatever is stored (including a non-object, or an entry salvage rejected)
 *  exactly as it is. */
function patchTemplates(
  rawTemplates: unknown,
  published: EmailTemplateOverrides,
  next: EmailTemplateOverrides
): Record<string, unknown> | null {
  const out: Record<string, unknown> = isPlainObject(rawTemplates)
    ? { ...rawTemplates }
    : {}
  let changed = false
  // Reset-to-default: an id that was published and is now gone is a deliberate delete.
  for (const id of Object.keys(published))
    if (!(id in next)) {
      delete out[id]
      changed = true
    }
  for (const [id, entry] of Object.entries(next))
    if (entryKey(published[id]) !== entryKey(entry)) {
      out[id] = entry
      changed = true
    }
  return changed ? out : null
}
