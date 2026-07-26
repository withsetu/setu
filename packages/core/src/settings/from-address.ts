import { z } from 'zod'

/** The addr-spec rule. */
const emailAddress = z.string().email()

/**
 * A From header may carry a display name — `Setu <hello@example.com>` — and that is the normal way
 * to configure one. Verified against both transports' current docs rather than from memory:
 * Resend's send-email reference ("To include a friendly name, pass the sender as
 * `Name <email@example.com>`") and nodemailer's message reference ("a plain address like
 * 'sender@server.com' or include a display name like '"Sender Name" <sender@server.com>'").
 *
 * So the format check has to validate the ADDR-SPEC inside the angle brackets, not the whole header
 * value: running the whole value through `z.string().email()` rejects every display-name
 * configuration.
 *
 * The display name is checked for exactly one thing: no control characters. A From header is a
 * single line, and this is the one branch where a newline could ride through on the half of the
 * value that is not an addr-spec.
 */
const DISPLAY_NAME_FORM = /^([^<>]*)<([^<>]*)>$/
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/

/**
 * The value to send FROM (trimmed, display name intact), or null when no transport could use it.
 * Returns the whole value rather than the extracted addr-spec — dropping the display name would
 * silently rewrite a working configuration.
 *
 * #957 moved this out of apps/api so ONE rule serves all three surfaces that decide whether a
 * from-address is usable: `resolveFromAddress` in apps/api/src/capabilities.ts (the env var),
 * `emailSchema.fromAddress` in ./schema.ts (the stored value) and the admin field in
 * apps/admin/src/screens/settings/EmailSettings.tsx. A second implementation would be a security
 * divergence, not just duplication: the control-character branch is the header-injection guard, and
 * the settings side had no equivalent because `z.string().email()` happened to reject those values
 * for an unrelated reason.
 *
 * Every branch is pinned by packages/core/src/settings/from-address.test.ts and, at the env
 * surface, by apps/api/test/capabilities.test.ts ("sendableFromAddress" describe).
 */
export function sendableFromAddress(value: string): string | null {
  const trimmed = value.trim()
  if (CONTROL_CHAR.test(trimmed)) return null
  const displayName = DISPLAY_NAME_FORM.exec(trimmed)
  const addrSpec =
    displayName === null ? trimmed : (displayName[2] ?? '').trim()
  return emailAddress.safeParse(addrSpec).success ? trimmed : null
}
