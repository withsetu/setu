import type { EmailSettings as EmailValues } from '@setu/core'
import { patchSettingsGroup } from './settings-group-patch'

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
 * ## Why this is a wrapper and not its own rule (#978 review F2)
 *
 * It used to carry a bespoke per-ENTRY rule: a `templates` entry was an ATOM, identified by its
 * three known fields (`subject`/`html`/`text`) and replaced WHOLE when any of them changed. The
 * argument for it was the entry salvage rejects WHOLE — over EMAIL_TEMPLATE_MAX_ENTRY_BYTES, or a
 * non-slug id. That argument does not hold: a rejected-whole entry is absent from `published`, so
 * there is no object pair for the generic per-field rule to recurse into and it replaces the entry
 * whole too. Measured — byte-identical output on that case, and the whole 80-test email suite
 * passes unchanged against the generic rule.
 *
 * Where the two DID differ is the HOLLOWED entry: a known field dropped field-wise (a 20,001-char
 * `html`) while the entry itself stays under the size cap. Editing that entry's SUBJECT then
 * dropped the stored `html` under the atom rule and keeps it under the generic one — and keeping
 * it is #956's whole point, since the admin never touched that field. So the atom rule was not a
 * different-but-valid trade; it was the #956 defect one level deeper. Pinned by
 * apps/admin/test/email-settings-patch.test.ts ("an over-cap template body survives an edit to a
 * DIFFERENT field of the same entry").
 *
 * The named function stays because the 15 email-shaped cases in that test file are real salvage
 * outcomes worth exercising against the shared helper, and because this is where someone reading
 * the email screen looks for the rule. Read
 * {@link ./settings-group-patch.patchSettingsGroup}'s docblock before changing a call site — in
 * particular, a key missing from `next` is written as a DELETE.
 */
export function patchEmailGroup(
  rawEmail: unknown,
  published: EmailValues,
  next: EmailValues
): Record<string, unknown> {
  return patchSettingsGroup(rawEmail, published, next)
}
