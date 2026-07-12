import * as z from 'zod'

/** Setu's client-side minimum password length — the UX-layer mirror of the server's authoritative
 *  check (better-auth's `password.config.minPasswordLength`), so the error surfaces before a round
 *  trip rather than after. Shared by every screen that collects a new/changed password (the invite
 *  dialog, the owner password card, and the password-reset landing screen, #364) so the literal
 *  can't drift out of sync across them. */
export const MIN_PASSWORD_LENGTH = 12

/** A single Zod field for "a new password" — `.min(MIN_PASSWORD_LENGTH, ...)`. Compose into a
 *  larger schema (invite/owner-password/reset-password each add their own confirm/role/etc.
 *  fields around it). */
export const passwordField = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  )
