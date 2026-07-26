import { describe, expect, it, vi } from 'vitest'
import {
  createResetEmailGate,
  resetEmailEnabled,
  resetEmailRefusal
} from '../src/reset-email-gate'
import type { ResetEmailRequest } from '@setu/auth'
import type { UsableEmailTransport } from '../src/capabilities'
import type { EmailConfig } from '../src/email-config'

const enabled = {
  from: 'site@example.test',
  adminOrigin: 'https://admin.example.test',
  effectiveTransport: 'resend' as const
}

/** A `UsableEmailTransport` reading, as `resolveEmailConfig` (../src/email-config.ts) would
 *  produce one. The sender takes the WHOLE reading (#919), not just `effective`, because the
 *  reading it gated on is the one it hands back for dispatch. */
const reading = (
  effective: UsableEmailTransport['effective']
): UsableEmailTransport => ({
  selected: effective,
  source: 'env',
  effective,
  problem: null
})

/** One `EmailConfig` reading — what `createLiveEmailConfig` hands the gate per send. #958 widened
 *  `resolveConfig` from `{ transport, from }` to the whole config, because the BODY is rendered
 *  off this same reading now. */
const config = (
  effective: UsableEmailTransport['effective'],
  from: string | undefined
): EmailConfig => ({
  from: {
    effective: from ?? null,
    source: from ? 'settings' : null,
    problem: null
  },
  transport: reading(effective),
  templates: undefined,
  siteTitle: 'Setu'
})

/** What @setu/auth hands `sendReset` (#958). `defaultContent` is its shipped body, which a gate
 *  built without a `render` of its own sends verbatim. */
const request = (): ResetEmailRequest => ({
  to: 'someone@example.test',
  url: 'https://api.example.test/api/auth/reset-password/tok?callbackURL=x',
  userName: 'Someone',
  defaultContent: () => ({
    subject: 'Reset your Setu password',
    html: '<p>x</p>',
    text: 'x'
  })
})

describe('resetEmailEnabled', () => {
  it('is true with a from-address, an admin origin and a real transport', () => {
    expect(resetEmailEnabled(enabled)).toBe(true)
    expect(resetEmailEnabled({ ...enabled, effectiveTransport: 'smtp' })).toBe(
      true
    )
  })

  it('is FALSE when the effective transport is the console adapter (#894)', () => {
    // The regression: from-address and admin origin present, so the old
    // `notifyFrom && adminOrigin` gate said "enabled" and the reset link went to stdout.
    expect(
      resetEmailEnabled({ ...enabled, effectiveTransport: 'console' })
    ).toBe(false)
  })

  it('is false without a from-address', () => {
    expect(resetEmailEnabled({ ...enabled, from: undefined })).toBe(false)
    expect(resetEmailEnabled({ ...enabled, from: '' })).toBe(false)
  })

  it('is false without an admin origin', () => {
    expect(resetEmailEnabled({ ...enabled, adminOrigin: undefined })).toBe(
      false
    )
  })
})

// #912: the reason an authenticated caller can be told, and the one the sender reports, must be
// the same string produced by the same function — otherwise `POST /api/users/send-reset` and the
// send it triggers can disagree about whether an email went out.
describe('resetEmailRefusal', () => {
  it('is null exactly when resetEmailEnabled is true', () => {
    const cases = [
      enabled,
      { ...enabled, effectiveTransport: 'console' as const },
      { ...enabled, from: undefined },
      { ...enabled, adminOrigin: undefined },
      {
        from: undefined,
        adminOrigin: undefined,
        effectiveTransport: 'console' as const
      }
    ]
    for (const p of cases)
      expect(resetEmailRefusal(p) === null).toBe(resetEmailEnabled(p))
  })

  it('names the console adapter, and never echoes the from-address', () => {
    const refusal = resetEmailRefusal({
      ...enabled,
      effectiveTransport: 'console'
    })
    expect(refusal?.reason).toContain('console adapter')
    expect(refusal?.reason).not.toContain(enabled.from)
  })

  // #944: one 409 used to carry two reasons — apps/api/src/users.ts collapsed every refusal into
  // `email_not_deliverable` and the Users screen answered it with "Pick a provider in
  // Settings → Email", which is the wrong thing to fix when the from-address is what is empty.
  it('gives each reason its own code, so the admin is told which setting to fix', () => {
    expect(
      resetEmailRefusal({ ...enabled, effectiveTransport: 'console' })?.code
    ).toBe('email_transport_not_deliverable')
    expect(resetEmailRefusal({ ...enabled, from: undefined })?.code).toBe(
      'email_from_address_missing'
    )
    expect(
      resetEmailRefusal({ ...enabled, adminOrigin: undefined })?.code
    ).toBe('reset_link_origin_missing')
    // Distinct codes AND distinct prose: a shared string would put the caller back where it was,
    // with one message for two different repairs.
    const refusals = [
      resetEmailRefusal({ ...enabled, effectiveTransport: 'console' })!,
      resetEmailRefusal({ ...enabled, from: undefined })!,
      resetEmailRefusal({ ...enabled, adminOrigin: undefined })!
    ]
    expect(new Set(refusals.map((r) => r.code)).size).toBe(3)
    expect(new Set(refusals.map((r) => r.reason)).size).toBe(3)
  })

  it('gives the sender its exact refusal', async () => {
    const onRefused = vi.fn()
    await createResetEmailGate({
      sendVia: vi.fn(),
      resolveConfig: () => config('console', enabled.from),
      bootFrom: undefined,
      adminOrigin: enabled.adminOrigin,
      onRefused
    }).sendReset(request())
    expect(onRefused.mock.calls[0]![0]).toEqual(
      resetEmailRefusal({ ...enabled, effectiveTransport: 'console' })
    )
  })
})

/** #944: `send` (better-auth's hook) and `refusal()` (POST /api/users/send-reset) were assembled
 *  separately and fell back differently on the from-address — the sender to better-auth's
 *  boot-time `msg.from`, the route to nothing. Clearing `email.fromAddress` in Settings → Email
 *  after boot therefore made the admin route answer 409 "no email was sent" while the PUBLIC
 *  forgot-password flow, through the very same sender, still sent one. Every case below asks both
 *  halves of ONE gate the same question and requires the same answer. */
describe('the route and the sender must agree on the from-address (#944)', () => {
  const gate = (
    live: string | undefined,
    bootFrom: string | undefined,
    effective: UsableEmailTransport['effective'] = 'resend'
  ) => {
    const sendVia = vi.fn()
    const onRefused = vi.fn()
    return {
      sendVia,
      onRefused,
      gate: createResetEmailGate({
        sendVia,
        resolveConfig: () => config(effective, live),
        bootFrom,
        adminOrigin: enabled.adminOrigin,
        onRefused
      })
    }
  }

  it('both send when the live from-address was cleared after boot', async () => {
    // settings.json's `email.fromAddress` cleared, SETU_FORMS_NOTIFY_FROM unset — the boot address
    // better-auth's `email.from` was wired with is what both halves fall back to.
    const { gate: g, sendVia, onRefused } = gate(undefined, 'boot@example.test')

    expect(g.refusal()).toBeNull()
    await g.sendReset(request())

    expect(onRefused).not.toHaveBeenCalled()
    expect(sendVia).toHaveBeenCalledTimes(1)
    expect(sendVia.mock.calls[0]![1]!.from).toBe('boot@example.test')
  })

  it('both refuse, with the same refusal, when the transport drifts to console', async () => {
    const {
      gate: g,
      sendVia,
      onRefused
    } = gate('live@example.test', 'boot@example.test', 'console')

    const routeAnswer = g.refusal()
    await g.sendReset(request())

    expect(sendVia).not.toHaveBeenCalled()
    expect(routeAnswer).toEqual(onRefused.mock.calls[0]![0])
    expect(routeAnswer?.code).toBe('email_transport_not_deliverable')
  })

  it('both refuse when neither the live reading nor boot has a from-address', async () => {
    const { gate: g, sendVia, onRefused } = gate(undefined, undefined)

    const routeAnswer = g.refusal()
    await g.sendReset(request())

    expect(sendVia).not.toHaveBeenCalled()
    expect(routeAnswer).toEqual(onRefused.mock.calls[0]![0])
    expect(routeAnswer?.code).toBe('email_from_address_missing')
  })
})

describe('createResetEmailGate', () => {
  it('sends through the live transport, with the live from-address', async () => {
    const sendVia = vi.fn()
    const onRefused = vi.fn()
    const { sendReset } = createResetEmailGate({
      sendVia,
      resolveConfig: () => config('resend', 'live@example.test'),
      // The live reading wins over the boot address, which is #498's whole point.
      bootFrom: 'boot@example.test',
      adminOrigin: 'https://admin.example.test',
      onRefused
    })

    await sendReset(request())

    expect(onRefused).not.toHaveBeenCalled()
    expect(sendVia).toHaveBeenCalledTimes(1)
    expect(sendVia.mock.calls[0]![1]).toMatchObject({
      to: request().to,
      from: 'live@example.test',
      text: 'x'
    })
  })

  // #919, the TOCTOU this shape exists to close: the sender used to resolve the transport for the
  // gate and then call a `send` that resolved AGAIN, so a settings.json rewrite landing between
  // the two (Git-canonical file — a pull/checkout/deploy rewrites it with no coordination) could
  // put a live reset token through the console adapter into the server log. Now the reading the
  // gate decided on is the object handed to `sendVia`.
  it('delivers through the EXACT reading it gated on — transport AND from-address — resolving each once', async () => {
    const sendVia = vi.fn()
    let configCalls = 0
    const readings = [reading('smtp'), reading('console')]
    const { sendReset } = createResetEmailGate({
      sendVia,
      // The stub answers differently on a second call — the settings.json rewrite landing
      // mid-send. It MUST flip, in both members: a constant stub cannot tell one reading from
      // two, which is exactly how the from-address half of this claim went unenforced back when
      // the sender took two resolvers and this test counted only the transport one.
      // #958: the BODY rides the same reading, so `render` below reads the flipping config too —
      // a second parse would show up as a mismatched subject as well as a mismatched transport.
      resolveConfig: () => {
        const i = Math.min(configCalls++, 1)
        return {
          ...config(
            readings[i]!.effective,
            i === 0 ? 'first@x.test' : 'second@x.test'
          ),
          transport: readings[i]!
        }
      },
      render: (c) => ({
        subject: `for ${c.from.effective}`,
        html: '<p>x</p>'
      }),
      bootFrom: undefined,
      adminOrigin: 'https://admin.example.test',
      onRefused: vi.fn()
    })

    await sendReset(request())

    // The substantive assertions first: what the gate judged is what the adapter receives.
    expect(sendVia).toHaveBeenCalledTimes(1)
    expect(sendVia.mock.calls[0]![0]).toBe(readings[0])
    expect(sendVia.mock.calls[0]![1]!.from).toBe('first@x.test')
    // …and the body was rendered from that same reading, not a later one.
    expect(sendVia.mock.calls[0]![1]!.subject).toBe('for first@x.test')
    // Corroboration: ONE reading for all THREE facts, so there is no window for a rewrite to land
    // in — and, since #958, one settings.json parse rather than two.
    expect(configCalls).toBe(1)
  })

  // The other half of #919's claim: binding the gate to ONE reading must not freeze it. The
  // gate is built once (server.ts builds it at boot), so if it cached its reading, a provider
  // saved in Settings → Email would never reach it — which is the #890 property the whole live
  // transport exists for. Two successive sends through ONE gate, transport and from-address
  // changing in between.
  it('re-resolves on every send — one reading per send, not one for the sender', async () => {
    const sendVia = vi.fn()
    let transport = reading('resend')
    let from = 'first@x.test'
    const { sendReset } = createResetEmailGate({
      sendVia,
      resolveConfig: () => ({
        ...config(transport.effective, from),
        transport
      }),
      bootFrom: undefined,
      adminOrigin: 'https://admin.example.test',
      onRefused: vi.fn()
    })

    await sendReset(request())

    // The admin saves a new provider and a new from-address; the sender is NOT rebuilt.
    const second = reading('smtp')
    transport = second
    from = 'second@x.test'
    await sendReset(request())

    expect(sendVia).toHaveBeenCalledTimes(2)
    expect(sendVia.mock.calls[0]![0]!.effective).toBe('resend')
    expect(sendVia.mock.calls[0]![1]!.from).toBe('first@x.test')
    expect(sendVia.mock.calls[1]![0]).toBe(second)
    expect(sendVia.mock.calls[1]![1]!.from).toBe('second@x.test')
  })

  it('falls back to the BOOT from-address when nothing is live', async () => {
    const sendVia = vi.fn()
    const { sendReset } = createResetEmailGate({
      sendVia,
      resolveConfig: () => config('smtp', undefined),
      bootFrom: 'boot@example.test',
      adminOrigin: 'https://admin.example.test',
      onRefused: vi.fn()
    })

    // #944: `bootFrom` is the only fallback. It used to compete with a `from` better-auth carried
    // on the message itself — the sender's private fallback, which the admin route had no way to
    // apply (the disagreement pinned by the describe above); #958 removed that field from the
    // option entirely, so there is no second candidate left to prefer.
    await sendReset(request())

    // The from-address is bound by VALUE into the message the adapter receives — there is no
    // second reading of it downstream, which is why it never had the transport's TOCTOU shape.
    expect(sendVia.mock.calls[0]![1]).toMatchObject({
      from: 'boot@example.test'
    })
  })

  // #958: the gate owns the BODY as well as the dispatch. server.ts injects `render` (the admin's
  // stored override, off the very reading the gate judged); with none injected the message is
  // @setu/auth's shipped default, which is what keeps `resetPasswordEmailContent` reachable now
  // that the separate `content` callback is gone.
  it('renders the body from the gated reading, and falls back to the shipped default without a renderer', async () => {
    const withRender = vi.fn()
    await createResetEmailGate({
      sendVia: withRender,
      resolveConfig: () => config('resend', 'live@example.test'),
      render: (c, req) => ({
        subject: `${c.siteTitle} — ${req.userName}`,
        html: `<p>${req.url}</p>`
      }),
      bootFrom: undefined,
      adminOrigin: enabled.adminOrigin,
      onRefused: vi.fn()
    }).sendReset(request())
    expect(withRender.mock.calls[0]![1]).toMatchObject({
      subject: 'Setu — Someone',
      html: `<p>${request().url}</p>`
    })

    const withoutRender = vi.fn()
    await createResetEmailGate({
      sendVia: withoutRender,
      resolveConfig: () => config('resend', 'live@example.test'),
      bootFrom: undefined,
      adminOrigin: enabled.adminOrigin,
      onRefused: vi.fn()
    }).sendReset(request())
    expect(withoutRender.mock.calls[0]![1]).toMatchObject(
      request().defaultContent()
    )
  })

  it('refuses to send when the transport drifts to console after boot (#890 live provider)', async () => {
    const sendVia = vi.fn()
    const onRefused = vi.fn()
    // Boot could legitimately have wired reset (resend was usable then); settings.json now
    // names a provider that resolves to the console adapter.
    const { sendReset } = createResetEmailGate({
      sendVia,
      resolveConfig: () => config('console', 'live@example.test'),
      bootFrom: 'boot@example.test',
      adminOrigin: 'https://admin.example.test',
      onRefused
    })

    await expect(sendReset(request())).resolves.toBeUndefined()

    expect(sendVia).not.toHaveBeenCalled()
    expect(onRefused).toHaveBeenCalledTimes(1)
    expect(String(onRefused.mock.calls[0]![0]!.reason)).toContain(
      'console adapter'
    )
  })

  // Defence in depth, NOT a production scenario — which is why `bootFrom` has to be left empty to
  // get here. As wired in apps/api/src/server.ts the `email:` option is built inside a branch that
  // narrows `notifyFrom` to a non-empty string, and that same value is the gate's `bootFrom`, so
  // `live ?? bootFrom` cannot be falsy at runtime. The old name ('refuses when the from-address
  // disappears after boot') claimed the unreachable case as a real one (#914); the transport-drift
  // case above it is the one that genuinely can happen after boot.
  // #944 made this branch unreachable through the ADMIN ROUTE too, rather than only through the
  // sender: both now read `live ?? bootFrom`, where they used to fall back differently.
  it('refuses when neither the live reading nor boot supplies a from-address', async () => {
    const sendVia = vi.fn()
    const onRefused = vi.fn()
    const { sendReset } = createResetEmailGate({
      sendVia,
      resolveConfig: () => config('resend', undefined),
      bootFrom: undefined,
      adminOrigin: 'https://admin.example.test',
      onRefused
    })

    await sendReset(request())

    expect(sendVia).not.toHaveBeenCalled()
    expect(onRefused).toHaveBeenCalledTimes(1)
  })
})
