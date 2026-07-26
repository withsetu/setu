import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createAuth } from '@setu/auth'
import { createConsoleEmailAdapter } from '@setu/email-console'
import {
  DEFAULT_SETTINGS,
  EMAIL_TYPE_PASSWORD_RESET,
  passwordResetValues,
  type EmailMessage,
  type EmailTemplateOverride,
  type EmailTemplateOverrides,
  type SiteSettings
} from '@setu/core'
import type { UsableEmailTransport } from '../src/capabilities'
import { createLiveEmailConfig, type EmailConfig } from '../src/email-config'
import { createLiveEmailTemplates } from '../src/email-templates'
import { createEmailDispatcher } from '../src/email-transport'
import {
  createResetEmailGate,
  resetEmailEnabled
} from '../src/reset-email-gate'

/** A `UsableEmailTransport` reading of the given effective kind — what `resolveEmailConfig`
 *  (../src/email-config.ts) hands the gate, and (since #919) what the gate hands back for
 *  dispatch. */
const reading = (
  effective: UsableEmailTransport['effective']
): UsableEmailTransport => ({
  selected: effective,
  source: 'env',
  effective,
  problem: null
})

/** One `EmailConfig` reading, stubbed at the transport/from-address end and real at the template
 *  end. #958 widened the gate's `resolveConfig` to the whole config, because the BODY renders off
 *  the same reading now. */
const configOf = (
  effective: UsableEmailTransport['effective'],
  from: string | undefined,
  templates: EmailTemplateOverrides | undefined
): EmailConfig => ({
  from: {
    effective: from ?? null,
    source: from ? 'settings' : null,
    problem: null
  },
  transport: reading(effective),
  templates,
  siteTitle: DEFAULT_SETTINGS.general.title || 'Setu'
})

/** #894 end-to-end: the REAL better-auth reset flow, the REAL console adapter, and a REAL
 *  generated token — so the assertions cannot be vacuous the way a hand-written fake token or a
 *  logger that never sees the payload would be. `tee` keeps an un-redacted copy of every message
 *  the transport was handed, which is how the test learns the actual token to search the log for.
 *
 *  Mirrors the shape of server.ts's wiring: `email:` is present only when `resetEmailEnabled`
 *  says so, and its `sendReset` is the gate `createResetEmailGate` returns, with the same
 *  `render` arm (#499's live template resolver) always supplied. NOT exactly, and the difference
 *  matters — `harness` STUBS the transport and the from-address rather than resolving them from
 *  settings. The claim used to be "exactly", which is precisely the place a reviewer asking "is
 *  the composed path covered?" would look and stop (CLAUDE.md §4 #21) — it was not. The
 *  composition server.ts actually runs is covered by the "composed send path" describe at the
 *  bottom of this file, which drives all three concerns off one settings object and, since #958,
 *  off ONE reading of it — exactly as production does. */
const ADMIN_ORIGIN = 'http://localhost:5173'
const FROM = 'site@example.test'
const USER_EMAIL = 'target@example.test'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

/** `storedTemplate` is what an admin saved in Settings → Email, resolved through the SAME live
 *  resolver server.ts injects as the gate's `render` — so a case that passes here is exercising
 *  the real template fill, not a hand-built body. Omitted → no override, i.e. the shipped
 *  default, which is what the other cases here want. */
function harness(
  effectiveTransport: UsableEmailTransport['effective'],
  storedTemplate?: EmailTemplateOverride
) {
  const dir = mkdtempSync(join(tmpdir(), 'reset-leak-'))
  const sqlite = new Database(join(dir, 'auth.db'))
  cleanups.push(() => {
    sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

  // What the server's stdout would show. The console adapter is the transport in EVERY case
  // here, including the 'resend' one — that is deliberate: it means the deliverable-direction
  // test still proves the adapter itself cannot print a token.
  const logged: string[] = []
  const consoleAdapter = createConsoleEmailAdapter((line) => logged.push(line))
  const tee: EmailMessage[] = []
  const refusals: string[] = []

  const enabled = resetEmailEnabled({
    from: FROM,
    adminOrigin: ADMIN_ORIGIN,
    effectiveTransport
  })

  const stored: EmailTemplateOverrides =
    storedTemplate === undefined
      ? {}
      : { [EMAIL_TYPE_PASSWORD_RESET]: storedTemplate }
  const templates = createLiveEmailTemplates({
    settings: () => ({
      ...DEFAULT_SETTINGS,
      email: { ...DEFAULT_SETTINGS.email, templates: stored }
    })
  })

  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: [ADMIN_ORIGIN],
    rateLimit: { enabled: false },
    ...(enabled
      ? {
          email: {
            sendReset: createResetEmailGate({
              sendVia: async (_transport, msg) => {
                tee.push(msg)
                await consoleAdapter.send(msg)
              },
              resolveConfig: () => configOf(effectiveTransport, FROM, stored),
              render: (config, request) =>
                templates.renderWith(
                  config,
                  EMAIL_TYPE_PASSWORD_RESET,
                  passwordResetValues({
                    url: request.url,
                    userName: request.userName,
                    userEmail: request.to
                  })
                ),
              bootFrom: FROM,
              adminOrigin: ADMIN_ORIGIN,
              onRefused: (refusal) => refusals.push(refusal.reason)
            }).sendReset,
            resetRedirectTo: `${ADMIN_ORIGIN}/reset-password`
          }
        }
      : {})
  })

  return { auth, db, logged, tee, refusals, enabled }
}

async function makeUser(auth: ReturnType<typeof createAuth>) {
  const ctx = await auth.$context
  await ctx.internalAdapter.createUser({
    email: USER_EMAIL,
    name: 'Target',
    role: 'admin',
    emailVerified: true
  })
}

/** The token better-auth put in the link, read out of the un-redacted copy. */
function tokenOf(msg: EmailMessage): string {
  const match = /reset-password\/([A-Za-z0-9_-]+)/.exec(msg.text ?? '')
  expect(
    match,
    'the reset email should carry a /reset-password/<token> link'
  ).not.toBeNull()
  const token = match![1]!
  // Guard against asserting on something too short to be a credential (a 1-char "token" would
  // make every "log does not contain it" assertion trivially unreliable).
  expect(token.length).toBeGreaterThanOrEqual(16)
  return token
}

describe('password reset never writes a token to the console transport (#894)', () => {
  it('is DISABLED when the effective transport is the console adapter, and logs nothing', async () => {
    const h = harness('console')
    expect(h.enabled).toBe(false)
    await makeUser(h.auth)

    const res = await h.auth.api.requestPasswordReset({
      body: { email: USER_EMAIL, redirectTo: `${ADMIN_ORIGIN}/reset-password` },
      asResponse: true
    })

    // better-auth's own gate: no `sendResetPassword` callback => RESET_PASSWORD_DISABLED.
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain(
      'RESET_PASSWORD_DISABLED'
    )
    // Nothing was minted and nothing was printed.
    expect(h.tee).toEqual([])
    expect(h.logged).toEqual([])
  })

  it('still sends normally when the transport is deliverable', async () => {
    const h = harness('resend')
    expect(h.enabled).toBe(true)
    await makeUser(h.auth)

    const res = await h.auth.api.requestPasswordReset({
      body: { email: USER_EMAIL, redirectTo: `${ADMIN_ORIGIN}/reset-password` },
      asResponse: true
    })

    expect(res.status).toBe(200)
    expect(h.refusals).toEqual([])
    expect(h.tee).toHaveLength(1)
    const msg = h.tee[0]!
    expect(msg.to).toBe(USER_EMAIL)
    expect(msg.from).toBe(FROM)
    // The real message still carries a usable link — the fix must not break the feature.
    expect(msg.text).toContain(`/reset-password/${tokenOf(msg)}`)
  })

  it('redacts the REAL token when a deliverable send lands on the console adapter anyway', async () => {
    // Defence in depth: the transport claims to be 'resend' (so the gate is open) while the
    // adapter behind it is the console one. That is the shape any future re-wiring would take.
    const h = harness('resend')
    await makeUser(h.auth)

    await h.auth.api.requestPasswordReset({
      body: { email: USER_EMAIL, redirectTo: `${ADMIN_ORIGIN}/reset-password` },
      asResponse: true
    })

    const token = tokenOf(h.tee[0]!)
    expect(h.logged).toHaveLength(1)
    expect(h.logged[0]).not.toContain(token)
    expect(h.logged[0]).not.toContain(encodeURIComponent(token))
    // Still a useful dev log line: who it went to, and that it was a reset.
    expect(h.logged[0]).toContain(USER_EMAIL)
    expect(h.logged[0]).toContain('Reset your Setu password')
  })

  /**
   * #910. Since #499 the body is ADMIN-authored: `{{reset_url}}` can be placed anywhere, and the
   * redactor's idea of where a URL stops decides whether the token survives. This drives the real
   * better-auth flow, the real live template resolver and the real console adapter, and learns
   * the token from the un-redacted `tee` — so the assertion cannot be vacuous.
   *
   * The template mixes the two habits a markdown-fluent admin brings to a raw HTML body: a
   * `[label](url)` link and `_url_` emphasis. Worth knowing which half bites HERE: the emphasis
   * one. A shipped reset link always ends in `?callbackURL=<encoded admin origin>`
   * (packages/auth/src/reset-password-email.ts's withDefaultResetCallback guarantees a non-empty
   * one), so a trailing `)` lands on the callback VALUE — which is itself a URL and was already
   * recursed — while the token sits safely bounded by `?`. The leading `_` instead defeated
   * URL_RE's `\b` and left the entire link, token and all, unmatched. The bracket shape on a link
   * that ENDS at its token — the reported #910 case, and what any future token-terminated link
   * would look like — is pinned directly in packages/email-console/test/redact.test.ts.
   */
  it('redacts the REAL token out of an admin-CUSTOMIZED template body (#910)', async () => {
    const h = harness('resend', {
      html: [
        '<p>Hi {{user_name}},</p>',
        '<p>[Reset your password]({{reset_url}})</p>',
        '<p>Or copy this link: _{{reset_url}}_</p>'
      ].join('\n')
    })
    await makeUser(h.auth)

    await h.auth.api.requestPasswordReset({
      body: { email: USER_EMAIL, redirectTo: `${ADMIN_ORIGIN}/reset-password` },
      asResponse: true
    })

    // The stored template really applied, and really produced the wrapped shapes — otherwise the
    // "log has no token" assertion below would be measuring the shipped default instead.
    const sent = h.tee[0]!
    expect(sent.text).toContain('[Reset your password](http')
    expect(sent.text).toContain('_http')

    const token = tokenOf(sent)
    expect(h.logged).toHaveLength(1)
    expect(h.logged[0]).not.toContain(token)
    expect(h.logged[0]).not.toContain(encodeURIComponent(token))
    // Still a useful dev log line.
    expect(h.logged[0]).toContain(USER_EMAIL)
    expect(h.logged[0]).toContain('[redacted]')
  })

  it('refuses at SEND time when the live transport drifts to console after boot', async () => {
    // The gate is boot-time; the provider is live (#890). Simulate the drift by flipping the
    // resolver after the auth instance is built.
    const dir = mkdtempSync(join(tmpdir(), 'reset-leak-drift-'))
    const sqlite = new Database(join(dir, 'auth.db'))
    cleanups.push(() => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const db = drizzle(sqlite)
    migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

    let live: UsableEmailTransport['effective'] = 'resend'
    const logged: string[] = []
    const consoleAdapter = createConsoleEmailAdapter((l) => logged.push(l))
    const onRefused = vi.fn()

    const auth = createAuth({
      db,
      secret: 'test-secret-32-chars-minimum!!!!',
      baseURL: 'http://localhost:4444',
      trustedOrigins: [ADMIN_ORIGIN],
      rateLimit: { enabled: false },
      email: {
        sendReset: createResetEmailGate({
          sendVia: (_transport, msg) => consoleAdapter.send(msg),
          resolveConfig: () => configOf(live, FROM, undefined),
          bootFrom: FROM,
          adminOrigin: ADMIN_ORIGIN,
          onRefused
        }).sendReset,
        resetRedirectTo: `${ADMIN_ORIGIN}/reset-password`
      }
    })
    await makeUser(auth)

    live = 'console'
    const res = await auth.api.requestPasswordReset({
      body: { email: USER_EMAIL, redirectTo: `${ADMIN_ORIGIN}/reset-password` },
      asResponse: true
    })

    // Enumeration-uniform response is preserved; nothing reached the log.
    expect(res.status).toBe(200)
    expect(logged).toEqual([])
    expect(onRefused).toHaveBeenCalledTimes(1)
  })

  /**
   * #919: the gate's decision must BIND the dispatch. The sender used to resolve the transport
   * for its gate and then call a `send` that resolved a second time, so a `settings.json` rewrite
   * landing in that window — the file is Git-canonical, so a pull/checkout/deploy rewrites it with
   * no coordination with the running process — admitted the message on reading A and delivered it
   * on reading B. The whole wiring here is REAL: `createLiveEmailConfig` over a flipping SETTINGS
   * getter (see the comment on it below — #959 left transport selection to that resolver alone),
   * the real better-auth flow, a real minted token, and the real console adapter.
   *
   * The assertion is that the console adapter is never CALLED, not that the log lacks the token:
   * packages/email-console redacts, which is deliberate defence in depth (#910) and would mask a
   * raw-token assertion here. What the gate promises is that the message never reaches that
   * transport at all.
   */
  it('a provider flip between the gate and the dispatch cannot re-route the link to the console adapter (#919)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reset-leak-toctou-'))
    const sqlite = new Database(join(dir, 'auth.db'))
    cleanups.push(() => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const db = drizzle(sqlite)
    migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

    const logged: string[] = []
    const consoleAdapter = createConsoleEmailAdapter((l) => logged.push(l))
    const smtpSent: EmailMessage[] = []
    const env = { SETU_SMTP_HOST: '127.0.0.1', SETU_SMTP_PORT: '11025' }
    // 'smtp' on the FIRST read, 'console' on every read after: the settings flip, at the worst
    // possible instant. Pre-#919 the gate read first (smtp → admit) and the send read second
    // (console → log the link). The flip lives in the SETTINGS getter — where a `git pull` puts
    // it — rather than in a provider thunk, which is also the shape server.ts wires (#959 left
    // selection to `createLiveEmailConfig` alone).
    let settingsReads = 0
    const liveEmailConfig = createLiveEmailConfig({
      settings: () => ({
        ...DEFAULT_SETTINGS,
        email: {
          ...DEFAULT_SETTINGS.email,
          provider: ++settingsReads === 1 ? 'smtp' : 'console'
        }
      }),
      env
    })
    const email = createEmailDispatcher({
      env,
      adapters: {
        console: () => consoleAdapter,
        resend: () => consoleAdapter,
        smtp: () => ({
          send: async (msg: EmailMessage) => {
            smtpSent.push(msg)
          }
        })
      }
    })
    const onRefused = vi.fn()

    const auth = createAuth({
      db,
      secret: 'test-secret-32-chars-minimum!!!!',
      baseURL: 'http://localhost:4444',
      trustedOrigins: [ADMIN_ORIGIN],
      rateLimit: { enabled: false },
      email: {
        sendReset: createResetEmailGate({
          sendVia: (transport, msg) => email.sendVia(transport, msg),
          resolveConfig: liveEmailConfig,
          bootFrom: FROM,
          adminOrigin: ADMIN_ORIGIN,
          onRefused
        }).sendReset,
        resetRedirectTo: `${ADMIN_ORIGIN}/reset-password`
      }
    })
    await makeUser(auth)

    const res = await auth.api.requestPasswordReset({
      body: { email: USER_EMAIL, redirectTo: `${ADMIN_ORIGIN}/reset-password` },
      asResponse: true
    })

    expect(res.status).toBe(200)
    // The invariant: the console transport never saw the message.
    expect(logged).toEqual([])
    // And the feature still works — delivered through the very reading that was gated on.
    expect(onRefused).not.toHaveBeenCalled()
    expect(smtpSent).toHaveLength(1)
    expect(smtpSent[0]!.to).toBe(USER_EMAIL)
    expect(smtpSent[0]!.text).toContain(
      `/reset-password/${tokenOf(smtpSent[0]!)}`
    )
    // One reading per send — a second settings read is the whole defect. Since #958 that also
    // covers the BODY, which used to come from a separate @setu/auth callback with a reading of
    // its own (apps/api/test/email-read-count.test.ts counts it directly).
    expect(settingsReads).toBe(1)
  })
})

/**
 * #938, finding 2: the three increments of the email wave — the from-address (#498), the
 * transport (#890) and the stored template (#499) — meet in exactly ONE place in production,
 * server.ts's `createAuth({ email: … })`, and no test at any layer ran that composition.
 * Coverage was per-increment and disjoint: the transport tests use fake templates, the
 * capabilities tests have no templates, the template tests have no transport. The harness above
 * looked like it closed the gap and did not — it stubs the transport and the from-address rather
 * than resolving them from settings, which is still true now that it always supplies the `render`
 * arm.
 *
 * This drives the real composition over ONE settings object: the real `resolveEmailConfig` picks
 * the adapter, the real `createLiveEmailTemplates` renders the override, the real better-auth flow
 * mints a real token. Every assertion names a fact that can only have come from settings, so the
 * test fails if ANY one of the three stops being honored (kill-shot tested: each of the three,
 * disabled in turn, fails an assertion here).
 *
 * All THREE ride a single `EmailConfig` since #958 — the from-address and the transport, which
 * `createResetEmailGate`'s `resolveConfig` resolves once and binds together so the reading the
 * gate judges is the object that dispatches (#919), plus the body, which its `render` arm builds
 * from that same reading. It used to be two-plus-one: the body came from a separate `content:`
 * callback with a reading of its own, because `content` and `send` were two independent
 * @setu/auth callbacks, which is what made this path cost two settings parses (#939). So this file
 * now proves the three concerns agree on one MESSAGE *and* come from one reading; the exact count
 * is asserted by apps/api/test/email-read-count.test.ts, 'parses settings.json exactly ONCE, and a
 * save applies to the next reset'.
 */
describe('the composed send path: settings drive transport, from-address and body on ONE send (#938)', () => {
  const SETTINGS: SiteSettings = {
    ...DEFAULT_SETTINGS,
    general: { ...DEFAULT_SETTINGS.general, title: 'Settings Site' },
    email: {
      ...DEFAULT_SETTINGS.email,
      fromAddress: 'settings-from@example.test',
      provider: 'smtp',
      templates: {
        [EMAIL_TYPE_PASSWORD_RESET]: {
          subject: 'Reset for {{site_title}}',
          html: '<p>settings-body {{reset_url}}</p>'
        }
      }
    }
  }

  it('all three follow settings on the same message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reset-composed-'))
    const sqlite = new Database(join(dir, 'auth.db'))
    cleanups.push(() => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const db = drizzle(sqlite)
    migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })

    // Env deliberately says CONSOLE and carries a DIFFERENT from-address, so every assertion
    // below distinguishes "settings won" from "the env happened to agree".
    const env = {
      SETU_EMAIL_ADAPTER: 'console',
      SETU_FORMS_NOTIFY_FROM: 'env-from@example.test',
      SETU_SMTP_HOST: '127.0.0.1',
      SETU_SMTP_PORT: '11025'
    }
    const liveEmailConfig = createLiveEmailConfig({
      settings: () => SETTINGS,
      env
    })
    const consoleLog: string[] = []
    const consoleAdapter = createConsoleEmailAdapter((l) => consoleLog.push(l))
    const smtpSent: EmailMessage[] = []
    const email = createEmailDispatcher({
      env,
      adapters: {
        console: () => consoleAdapter,
        resend: () => consoleAdapter,
        smtp: () => ({
          send: async (msg: EmailMessage) => {
            smtpSent.push(msg)
          }
        })
      }
    })
    const templates = createLiveEmailTemplates({ settings: () => SETTINGS })

    const auth = createAuth({
      db,
      secret: 'test-secret-32-chars-minimum!!!!',
      baseURL: 'http://localhost:4444',
      trustedOrigins: [ADMIN_ORIGIN],
      rateLimit: { enabled: false },
      email: {
        sendReset: createResetEmailGate({
          resolveConfig: liveEmailConfig,
          render: (config, request) =>
            templates.renderWith(
              config,
              EMAIL_TYPE_PASSWORD_RESET,
              passwordResetValues({
                url: request.url,
                userName: request.userName,
                userEmail: request.to
              })
            ),
          sendVia: (transport, msg) => email.sendVia(transport, msg),
          // The boot-time fallback. It is the ENV address on purpose: if the live resolver ever
          // stopped winning, `msg.from` below would say so.
          bootFrom: 'env-from@example.test',
          adminOrigin: ADMIN_ORIGIN,
          onRefused: (refusal) => {
            throw new Error(`unexpected refusal: ${refusal.reason}`)
          }
        }).sendReset,
        resetRedirectTo: `${ADMIN_ORIGIN}/reset-password`
      }
    })
    await makeUser(auth)

    const res = await auth.api.requestPasswordReset({
      body: { email: USER_EMAIL, redirectTo: `${ADMIN_ORIGIN}/reset-password` },
      asResponse: true
    })
    expect(res.status).toBe(200)

    // 1. TRANSPORT followed settings.json's `provider: 'smtp'`, not SETU_EMAIL_ADAPTER=console.
    expect(smtpSent).toHaveLength(1)
    expect(consoleLog).toEqual([])
    const msg = smtpSent[0]!
    // 2. FROM followed settings.json's `fromAddress`, not SETU_FORMS_NOTIFY_FROM and not the
    //    gate's boot-time fallback.
    expect(msg.from).toBe('settings-from@example.test')
    // 3. BODY followed the stored override — subject, html, AND the `{{site_title}}` ambient
    //    value, which comes from Settings → General on the same reading.
    expect(msg.subject).toBe('Reset for Settings Site')
    expect(msg.html).toContain('settings-body')
    // …and the link is still the real, callback-defaulted one better-auth minted: a template can
    // PLACE {{reset_url}} but never supply one.
    expect(msg.text).toContain(`/reset-password/${tokenOf(msg)}`)
    expect(msg.text).toContain('callbackURL=')
  })
})
