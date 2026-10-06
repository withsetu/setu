import * as z from 'zod'

/** Setu's client-side minimum password length — the UX-layer mirror of the server's authoritative
 *  check (better-auth's `password.config.minPasswordLength`), so the error surfaces before a round
 *  trip rather than after. Shared by every screen that collects a new/changed password (the invite
 *  dialog, the owner password card, the password-reset landing screen, #364, and first-run setup,
 *  #1186) so the literal
 *  can't drift out of sync across them. */
export const MIN_PASSWORD_LENGTH = 12

/** The UX-layer mirror of better-auth's `password.config.maxPasswordLength` (its default, 128 —
 *  Setu does not override it). Since better-auth 1.7.6 every route that takes a password,
 *  sign-in included, rejects a longer one with PASSWORD_TOO_LONG, so the form says so first
 *  (#1186; apps/admin/test/lib/password-policy.test.ts). The server stays authoritative. */
export const MAX_PASSWORD_LENGTH = 128

/** A single Zod field for "a new password" — `.min(MIN_PASSWORD_LENGTH, ...)` and
 *  `.max(MAX_PASSWORD_LENGTH, ...)`. Compose into a
 *  larger schema (invite/owner-password/reset-password each add their own confirm/role/etc.
 *  fields around it). */
export const passwordField = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  )
  .max(
    MAX_PASSWORD_LENGTH,
    `Password must be at most ${MAX_PASSWORD_LENGTH} characters`
  )
