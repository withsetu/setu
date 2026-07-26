import { describe, expect, it, vi } from 'vitest'
import {
  createResetEmailSender,
  resetEmailEnabled,
  resetEmailRefusal
} from '../src/reset-email-gate'
import type { UsableEmailTransport } from '../src/capabilities'

const enabled = {
  from: 'site@example.test',
  adminOrigin: 'https://admin.example.test',
  effectiveTransport: 'resend' as const
}

/** A `UsableEmailTransport` reading, as `createLiveEmailTransport().resolve()` would return one.
 *  The sender takes the WHOLE reading (#919), not just `effective`, because the reading it gated
 *  on is the one it hands back for dispatch. */
const reading = (
  effective: UsableEmailTransport['effective']
): UsableEmailTransport => ({
  selected: effective,
  source: 'env',
  effective,
  problem: null
})

const message = {
  to: 'someone@example.test',
  from: 'boot@example.test',
  subject: 'Reset your Setu password',
  html: '<p>x</p>',
  text: 'x'
}

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
    const reason = resetEmailRefusal({
      ...enabled,
      effectiveTransport: 'console'
    })
    expect(reason).toContain('console adapter')
    expect(reason).not.toContain(enabled.from)
  })

  it('gives the sender its exact reason string', async () => {
    const onRefused = vi.fn()
    await createResetEmailSender({
      sendVia: vi.fn(),
      resolveConfig: () => ({
        transport: reading('console'),
        from: enabled.from
      }),
      adminOrigin: enabled.adminOrigin,
      onRefused
    })(message)
    expect(onRefused.mock.calls[0]![0]).toBe(
      resetEmailRefusal({ ...enabled, effectiveTransport: 'console' })
    )
  })
})

describe('createResetEmailSender', () => {
  it('sends through the live transport, with the live from-address', async () => {
    const sendVia = vi.fn()
    const onRefused = vi.fn()
    const sender = createResetEmailSender({
      sendVia,
      resolveConfig: () => ({
        transport: reading('resend'),
        from: 'live@example.test'
      }),
      adminOrigin: 'https://admin.example.test',
      onRefused
    })

    await sender(message)

    expect(onRefused).not.toHaveBeenCalled()
    expect(sendVia).toHaveBeenCalledTimes(1)
    expect(sendVia.mock.calls[0]![1]).toMatchObject({
      to: message.to,
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
    const sender = createResetEmailSender({
      sendVia,
      // The stub answers differently on a second call — the settings.json rewrite landing
      // mid-send. It MUST flip, in both members: a constant stub cannot tell one reading from
      // two, which is exactly how the from-address half of this claim went unenforced back when
      // the sender took two resolvers and this test counted only the transport one.
      resolveConfig: () => {
        const i = Math.min(configCalls++, 1)
        return {
          transport: readings[i]!,
          from: i === 0 ? 'first@x.test' : 'second@x.test'
        }
      },
      adminOrigin: 'https://admin.example.test',
      onRefused: vi.fn()
    })

    await sender(message)

    // The substantive assertions first: what the gate judged is what the adapter receives.
    expect(sendVia).toHaveBeenCalledTimes(1)
    expect(sendVia.mock.calls[0]![0]).toBe(readings[0])
    expect(sendVia.mock.calls[0]![1]!.from).toBe('first@x.test')
    // Corroboration: ONE reading for both facts, so there is no window for a rewrite to land in
    // — and, since #939, one settings.json parse rather than two.
    expect(configCalls).toBe(1)
  })

  // The other half of #919's claim: binding the gate to ONE reading must not freeze it. The
  // sender is built once (server.ts builds it at boot), so if it cached its reading, a provider
  // saved in Settings → Email would never reach it — which is the #890 property the whole live
  // transport exists for. Two successive sends through ONE sender, transport and from-address
  // changing in between.
  it('re-resolves on every send — one reading per send, not one for the sender', async () => {
    const sendVia = vi.fn()
    let transport = reading('resend')
    let from = 'first@x.test'
    const sender = createResetEmailSender({
      sendVia,
      resolveConfig: () => ({ transport: transport, from: from }),
      adminOrigin: 'https://admin.example.test',
      onRefused: vi.fn()
    })

    await sender(message)

    // The admin saves a new provider and a new from-address; the sender is NOT rebuilt.
    const second = reading('smtp')
    transport = second
    from = 'second@x.test'
    await sender(message)

    expect(sendVia).toHaveBeenCalledTimes(2)
    expect(sendVia.mock.calls[0]![0]!.effective).toBe('resend')
    expect(sendVia.mock.calls[0]![1]!.from).toBe('first@x.test')
    expect(sendVia.mock.calls[1]![0]).toBe(second)
    expect(sendVia.mock.calls[1]![1]!.from).toBe('second@x.test')
  })

  it('falls back to the message from-address when nothing is live', async () => {
    const sendVia = vi.fn()
    const sender = createResetEmailSender({
      sendVia,
      resolveConfig: () => ({ transport: reading('smtp'), from: undefined }),
      adminOrigin: 'https://admin.example.test',
      onRefused: vi.fn()
    })

    await sender(message)

    // The from-address is bound by VALUE into the message the adapter receives — there is no
    // second reading of it downstream, which is why it never had the transport's TOCTOU shape.
    expect(sendVia.mock.calls[0]![1]).toMatchObject({
      from: 'boot@example.test'
    })
  })

  it('refuses to send when the transport drifts to console after boot (#890 live provider)', async () => {
    const sendVia = vi.fn()
    const onRefused = vi.fn()
    // Boot could legitimately have wired reset (resend was usable then); settings.json now
    // names a provider that resolves to the console adapter.
    const sender = createResetEmailSender({
      sendVia,
      resolveConfig: () => ({
        transport: reading('console'),
        from: 'live@example.test'
      }),
      adminOrigin: 'https://admin.example.test',
      onRefused
    })

    await expect(sender(message)).resolves.toBeUndefined()

    expect(sendVia).not.toHaveBeenCalled()
    expect(onRefused).toHaveBeenCalledTimes(1)
    expect(String(onRefused.mock.calls[0]![0])).toContain('console adapter')
  })

  // Defence in depth, NOT a production scenario — which is why the message has to be
  // doctored with `from: ''` to get here. As wired in apps/api/src/server.ts the sender is
  // built inside a branch that narrows `notifyFrom` to a non-empty string and passes it as
  // better-auth's `from`, so `opts.resolveFrom() ?? msg.from` cannot be falsy at runtime.
  // The old name ('refuses when the from-address disappears after boot') claimed the
  // unreachable case as a real one (#914); the transport-drift case above it is the one
  // that genuinely can happen after boot.
  it('refuses when neither the live resolver nor the message supplies a from-address', async () => {
    const sendVia = vi.fn()
    const onRefused = vi.fn()
    const sender = createResetEmailSender({
      sendVia,
      resolveConfig: () => ({ transport: reading('resend'), from: undefined }),
      adminOrigin: 'https://admin.example.test',
      onRefused
    })

    await sender({ ...message, from: '' })

    expect(sendVia).not.toHaveBeenCalled()
    expect(onRefused).toHaveBeenCalledTimes(1)
  })
})
