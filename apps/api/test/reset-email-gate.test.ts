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
      resolveTransport: () => reading('console'),
      resolveFrom: () => enabled.from,
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
      resolveTransport: () => reading('resend'),
      resolveFrom: () => 'live@example.test',
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
  it('delivers through the EXACT reading it gated on, resolving only once', async () => {
    const sendVia = vi.fn()
    let calls = 0
    const readings = [reading('smtp'), reading('console')]
    const sender = createResetEmailSender({
      sendVia,
      // 'smtp' the first time, 'console' every time after — the flip mid-send.
      resolveTransport: () => readings[Math.min(calls++, 1)]!,
      resolveFrom: () => 'live@example.test',
      adminOrigin: 'https://admin.example.test',
      onRefused: vi.fn()
    })

    await sender(message)

    expect(calls).toBe(1)
    expect(sendVia).toHaveBeenCalledTimes(1)
    expect(sendVia.mock.calls[0]![0]).toBe(readings[0])
  })

  it('falls back to the message from-address when nothing is live', async () => {
    const sendVia = vi.fn()
    const sender = createResetEmailSender({
      sendVia,
      resolveTransport: () => reading('smtp'),
      resolveFrom: () => undefined,
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
      resolveTransport: () => reading('console'),
      resolveFrom: () => 'live@example.test',
      adminOrigin: 'https://admin.example.test',
      onRefused
    })

    await expect(sender(message)).resolves.toBeUndefined()

    expect(sendVia).not.toHaveBeenCalled()
    expect(onRefused).toHaveBeenCalledTimes(1)
    expect(String(onRefused.mock.calls[0]![0])).toContain('console adapter')
  })

  it('refuses when the from-address disappears after boot', async () => {
    const sendVia = vi.fn()
    const onRefused = vi.fn()
    const sender = createResetEmailSender({
      sendVia,
      resolveTransport: () => reading('resend'),
      resolveFrom: () => undefined,
      adminOrigin: 'https://admin.example.test',
      onRefused
    })

    await sender({ ...message, from: '' })

    expect(sendVia).not.toHaveBeenCalled()
    expect(onRefused).toHaveBeenCalledTimes(1)
  })
})
