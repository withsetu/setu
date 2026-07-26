import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createAuth } from '@setu/auth'
import { createMemorySubmissionPort } from '@setu/db-memory'
import {
  createSubmissionService,
  EMAIL_TYPE_FORM_NOTIFICATION,
  EMAIL_TYPE_PASSWORD_RESET,
  formNotificationValues,
  parseSettings,
  passwordResetValues,
  type EmailMessage
} from '@setu/core'
import { resolveSessionActor } from '../src/auth/resolve-session-actor'
import { createEmailApi } from '../src/email'
import { createLiveEmailConfig } from '../src/email-config'
import { createLiveEmailTemplates } from '../src/email-templates'
import { createLiveEmailTransport } from '../src/email-transport'
import { createResetEmailSender } from '../src/reset-email-gate'

/**
 * #939 — the regression test the old comment implied but never had.
 *
 * apps/api/src/server.ts's `loadSiteSettings` is `readFileSync` + `JSON.parse` + a full
 * `parseSettings` (six Zod group parses plus salvage), with no memoisation. It used to be reached
 * through four independent live getters, so ONE email cost three of those parses — on
 * `/forms/submit`, which is unauthenticated, that was three synchronous event-loop-blocking
 * parses per anonymous visitor request. The comment in server.ts nonetheless claimed "ONE getter,
 * so one email costs one settings read", naming a test that asserts `toHaveBeenCalledTimes(1)`
 * for ONE resolver in isolation — strictly narrower than the claim, and therefore reading as
 * verification for something false (CLAUDE.md §4 #21).
 *
 * Each case below wires the seams the way server.ts wires them, over a REAL settings.json and the
 * real `parseSettings`, and counts the reads for a whole send path. Every case also drives a save
 * BETWEEN two sends: the fix collapses reads, it must never hoist the read out of the send, and a
 * count assertion alone would be satisfied by a cache that froze the config at boot — which would
 * destroy the wave's headline property. Both halves are asserted together, on purpose.
 */
const ADMIN_ORIGIN = 'http://localhost:5173'
const TRUSTED_ORIGIN = ADMIN_ORIGIN

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

/** server.ts's `loadSiteSettings`, verbatim in shape, wrapped in a counter. */
function harness(initial: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'email-reads-'))
  const file = join(dir, 'settings.json')
  writeFileSync(file, JSON.stringify(initial))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

  const loadSiteSettings = vi.fn(() => {
    try {
      return parseSettings(JSON.parse(readFileSync(file, 'utf-8')) as unknown)
    } catch {
      return parseSettings(undefined)
    }
  })
  return {
    loadSiteSettings,
    reads: () => loadSiteSettings.mock.calls.length,
    resetCount: () => loadSiteSettings.mockClear(),
    save: (next: Record<string, unknown>) =>
      writeFileSync(file, JSON.stringify(next))
  }
}

const RESEND_ENV = { RESEND_API_KEY: 'test-fake-key' }

/** The transport + template seams, wired exactly as server.ts wires them over one loader. */
function wiring(h: ReturnType<typeof harness>, env = RESEND_ENV) {
  const liveEmailConfig = createLiveEmailConfig({
    settings: h.loadSiteSettings,
    env
  })
  const delivered: { kind: string; msg: EmailMessage }[] = []
  const adapter = (kind: string) => ({
    send: async (msg: EmailMessage) => {
      delivered.push({ kind, msg })
    }
  })
  const email = createLiveEmailTransport({
    env,
    provider: () => h.loadSiteSettings().email.provider,
    adapters: {
      console: () => adapter('console'),
      resend: () => adapter('resend'),
      smtp: () => adapter('smtp')
    }
  })
  const emailTemplates = createLiveEmailTemplates({
    settings: h.loadSiteSettings
  })
  return { liveEmailConfig, email, emailTemplates, delivered }
}

async function adminSession(auth: ReturnType<typeof createAuth>) {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({
    email: 'admin@test.com',
    name: 'admin',
    role: 'admin',
    emailVerified: true
  })
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash('a-strong-password-12')
  })
  const res = await auth.api.signInEmail({
    body: { email: 'admin@test.com', password: 'a-strong-password-12' },
    asResponse: true
  })
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

function authHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'email-reads-db-'))
  const sqlite = new Database(join(dir, 'auth.db'))
  cleanups.push(() => {
    sqlite.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: '../../packages/db-sqlite/drizzle' })
  return db
}

const CONFIGURED = {
  general: { title: 'My Site' },
  email: { fromAddress: 'first@example.test', provider: 'resend' }
}

describe('one email costs one settings read (#939)', () => {
  describe('test send — POST /api/email/test-send', () => {
    function build(h: ReturnType<typeof harness>) {
      const db = authHarness()
      const auth = createAuth({
        db,
        secret: 'test-secret-32-chars-minimum!!!!',
        baseURL: 'http://localhost:4444',
        trustedOrigins: [TRUSTED_ORIGIN]
      })
      const w = wiring(h)
      const app = createEmailApi({
        resolveActor: resolveSessionActor(auth),
        resolveConfig: w.liveEmailConfig,
        statusContext: {
          env: RESEND_ENV,
          mode: 'self-hosted',
          resetWiredAtBoot: true,
          authConfigured: true,
          adminOriginPresent: true
        },
        sendVia: (transport, msg) => w.email.sendVia(transport, msg)
      })
      return { app, auth, delivered: w.delivered }
    }

    const sendReq = (cookie: string) =>
      new Request('http://test/api/email/test-send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie }
      })

    it('parses settings.json exactly ONCE, and a save between two sends still applies to the second', async () => {
      const h = harness(CONFIGURED)
      const { app, auth, delivered } = build(h)
      const cookie = await adminSession(auth)

      h.resetCount()
      expect((await app.fetch(sendReq(cookie))).status).toBe(200)
      // Was 3: `status()` resolved the from-address and the provider, then `resolveTransport()`
      // resolved the provider again.
      expect(h.reads()).toBe(1)
      expect(delivered.at(-1)!.msg.from).toBe('first@example.test')

      // LIVENESS: the admin saves a new from-address. Nothing is rebuilt.
      h.save({
        ...CONFIGURED,
        email: { fromAddress: 'second@example.test', provider: 'resend' }
      })
      h.resetCount()
      expect((await app.fetch(sendReq(cookie))).status).toBe(200)
      expect(h.reads()).toBe(1)
      expect(delivered.at(-1)!.msg.from).toBe('second@example.test')
    })

    it('GET /api/email/status parses settings.json exactly ONCE, and follows a save', async () => {
      const h = harness(CONFIGURED)
      const { app, auth } = build(h)
      const cookie = await adminSession(auth)
      const statusReq = () =>
        new Request('http://test/api/email/status', { headers: { cookie } })

      h.resetCount()
      const first = (await (await app.fetch(statusReq())).json()) as {
        from: { effective: string }
      }
      expect(h.reads()).toBe(1)
      expect(first.from.effective).toBe('first@example.test')

      h.save({
        ...CONFIGURED,
        email: { fromAddress: 'second@example.test', provider: 'resend' }
      })
      h.resetCount()
      const second = (await (await app.fetch(statusReq())).json()) as {
        from: { effective: string }
      }
      expect(h.reads()).toBe(1)
      expect(second.from.effective).toBe('second@example.test')
    })
  })

  describe('form notification — the visitor-triggered path', () => {
    function build(h: ReturnType<typeof harness>) {
      const w = wiring(h)
      const service = createSubmissionService({
        submissions: createMemorySubmissionPort(),
        captcha: { verify: async () => true },
        email: w.email,
        notifyTo: 'owner@example.test',
        // The server.ts wiring, verbatim in shape.
        resolveNotification: () => {
          const config = w.liveEmailConfig()
          return {
            from: config.from.effective ?? undefined,
            render: (s) =>
              w.emailTemplates.renderWith(
                config,
                EMAIL_TYPE_FORM_NOTIFICATION,
                formNotificationValues(s)
              ),
            send: (msg) => w.email.sendVia(config.transport, msg)
          }
        }
      })
      return { service, delivered: w.delivered }
    }

    const submission = {
      formId: 'contact',
      formLabel: 'Contact',
      fields: { name: 'Ada', email: 'ada@x.test', message: 'hello there' },
      captchaToken: 'tok'
    }

    it('parses settings.json exactly ONCE per submission, and a save applies to the next one', async () => {
      const h = harness({
        ...CONFIGURED,
        email: {
          fromAddress: 'first@example.test',
          provider: 'resend',
          templates: {
            [EMAIL_TYPE_FORM_NOTIFICATION]: { subject: 'first-subject' }
          }
        }
      })
      const { service, delivered } = build(h)

      h.resetCount()
      expect(await service.submit({ ...submission })).toMatchObject({
        ok: true
      })
      // Was 3: the from-address, the template + site title, and the provider.
      expect(h.reads()).toBe(1)
      expect(delivered.at(-1)!.msg.from).toBe('first@example.test')
      expect(delivered.at(-1)!.msg.subject).toBe('first-subject')
      expect(delivered.at(-1)!.kind).toBe('resend')

      // LIVENESS: all three concerns change at once, and the NEXT notification must follow all
      // three — a config frozen at boot (or memoised across sends) fails every assertion here.
      h.save({
        ...CONFIGURED,
        email: {
          fromAddress: 'second@example.test',
          provider: 'console',
          templates: {
            [EMAIL_TYPE_FORM_NOTIFICATION]: { subject: 'second-subject' }
          }
        }
      })
      h.resetCount()
      expect(await service.submit({ ...submission })).toMatchObject({
        ok: true
      })
      expect(h.reads()).toBe(1)
      expect(delivered.at(-1)!.msg.from).toBe('second@example.test')
      expect(delivered.at(-1)!.msg.subject).toBe('second-subject')
      expect(delivered.at(-1)!.kind).toBe('console')
    })

    it('a rejected submission parses settings.json ZERO times — a bot cannot make a visitor pay for one', async () => {
      const h = harness(CONFIGURED)
      const { service } = build(h)

      h.resetCount()
      await service.submit({ ...submission, honeypot: 'i am a bot' })
      await service.submit({
        ...submission,
        fields: { email: 'nope', message: 'x' }
      })
      expect(h.reads()).toBe(0)
    })
  })

  describe('password reset — the createAuth wiring', () => {
    function build(h: ReturnType<typeof harness>) {
      const db = authHarness()
      const w = wiring(h)
      const refusals: string[] = []
      const auth = createAuth({
        db,
        secret: 'test-secret-32-chars-minimum!!!!',
        baseURL: 'http://localhost:4444',
        trustedOrigins: [TRUSTED_ORIGIN],
        rateLimit: { enabled: false },
        email: {
          send: createResetEmailSender({
            resolveConfig: () => {
              const config = w.liveEmailConfig()
              return {
                transport: config.transport,
                from: config.from.effective ?? undefined
              }
            },
            sendVia: (transport, msg) => w.email.sendVia(transport, msg),
            adminOrigin: ADMIN_ORIGIN,
            onRefused: (r) => refusals.push(r)
          }),
          content: ({ url, userName, userEmail }) =>
            w.emailTemplates.render(
              EMAIL_TYPE_PASSWORD_RESET,
              passwordResetValues({ url, userName, userEmail })
            ),
          from: 'first@example.test',
          resetRedirectTo: `${ADMIN_ORIGIN}/reset-password`
        }
      })
      return { auth, delivered: w.delivered, refusals }
    }

    async function makeUser(auth: ReturnType<typeof createAuth>) {
      const ctx = await auth.$context
      await ctx.internalAdapter.createUser({
        email: 'target@example.test',
        name: 'Target',
        role: 'admin',
        emailVerified: true
      })
    }

    /**
     * Measured baseline for this path was THREE, not the four #939's table reported: the body
     * render, the transport resolution and the from-address resolution. (Five is reachable, but
     * only on the ADMIN-triggered POST /api/users/send-reset, whose `resetEmailRefusal` added two
     * more — that is now one.)
     *
     * TWO, not one — and deliberately so. `content` and `send` are two independent @setu/auth
     * callbacks (packages/auth/src/index.ts's `sendResetPassword` invokes the body resolver and
     * then the sender), so binding them to a single reading would mean asserting that nothing
     * runs between them: a claim about another package's internals that no test in this package
     * could hold. Three became two here; merging the two callbacks into one is spun off.
     *
     * The number is asserted exactly, so ADDING a reader to this path fails — which is the whole
     * point of the test the old comment implied.
     */
    it('parses settings.json exactly TWICE (body + gate), and a save applies to the next reset', async () => {
      const h = harness({
        ...CONFIGURED,
        email: {
          fromAddress: 'first@example.test',
          provider: 'resend',
          templates: {
            [EMAIL_TYPE_PASSWORD_RESET]: {
              subject: 'first-subject',
              html: '<p>{{reset_url}}</p>'
            }
          }
        }
      })
      const { auth, delivered, refusals } = build(h)
      await makeUser(auth)

      h.resetCount()
      const res = await auth.api.requestPasswordReset({
        body: {
          email: 'target@example.test',
          redirectTo: `${ADMIN_ORIGIN}/reset-password`
        },
        asResponse: true
      })
      expect(res.status).toBe(200)
      expect(refusals).toEqual([])
      expect(h.reads()).toBe(2)
      expect(delivered.at(-1)!.msg.from).toBe('first@example.test')
      expect(delivered.at(-1)!.msg.subject).toBe('first-subject')
      expect(delivered.at(-1)!.kind).toBe('resend')

      // LIVENESS: from-address and template both change; the next reset must follow both.
      h.save({
        ...CONFIGURED,
        email: {
          fromAddress: 'second@example.test',
          provider: 'resend',
          templates: {
            [EMAIL_TYPE_PASSWORD_RESET]: {
              subject: 'second-subject',
              html: '<p>{{reset_url}}</p>'
            }
          }
        }
      })
      h.resetCount()
      await auth.api.requestPasswordReset({
        body: {
          email: 'target@example.test',
          redirectTo: `${ADMIN_ORIGIN}/reset-password`
        },
        asResponse: true
      })
      expect(h.reads()).toBe(2)
      expect(delivered.at(-1)!.msg.from).toBe('second@example.test')
      expect(delivered.at(-1)!.msg.subject).toBe('second-subject')
    })
  })
})
