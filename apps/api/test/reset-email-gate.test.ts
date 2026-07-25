import { describe, expect, it, vi } from 'vitest'
import {
  createResetEmailSender,
  resetEmailEnabled
} from '../src/reset-email-gate'

const enabled = {
  from: 'site@example.test',
  adminOrigin: 'https://admin.example.test',
  effectiveTransport: 'resend' as const
}

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

describe('createResetEmailSender', () => {
  it('sends through the live transport, with the live from-address', async () => {
    const send = vi.fn()
    const onRefused = vi.fn()
    const sender = createResetEmailSender({
      send,
      resolveTransport: () => 'resend',
      resolveFrom: () => 'live@example.test',
      adminOrigin: 'https://admin.example.test',
      onRefused
    })

    await sender(message)

    expect(onRefused).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toMatchObject({
      to: message.to,
      from: 'live@example.test',
      text: 'x'
    })
  })

  it('falls back to the message from-address when nothing is live', async () => {
    const send = vi.fn()
    const sender = createResetEmailSender({
      send,
      resolveTransport: () => 'smtp',
      resolveFrom: () => undefined,
      adminOrigin: 'https://admin.example.test',
      onRefused: vi.fn()
    })

    await sender(message)

    expect(send.mock.calls[0]![0]).toMatchObject({ from: 'boot@example.test' })
  })

  it('refuses to send when the transport drifts to console after boot (#890 live provider)', async () => {
    const send = vi.fn()
    const onRefused = vi.fn()
    // Boot could legitimately have wired reset (resend was usable then); settings.json now
    // names a provider that resolves to the console adapter.
    const sender = createResetEmailSender({
      send,
      resolveTransport: () => 'console',
      resolveFrom: () => 'live@example.test',
      adminOrigin: 'https://admin.example.test',
      onRefused
    })

    await expect(sender(message)).resolves.toBeUndefined()

    expect(send).not.toHaveBeenCalled()
    expect(onRefused).toHaveBeenCalledTimes(1)
    expect(String(onRefused.mock.calls[0]![0])).toContain('console adapter')
  })

  it('refuses when the from-address disappears after boot', async () => {
    const send = vi.fn()
    const onRefused = vi.fn()
    const sender = createResetEmailSender({
      send,
      resolveTransport: () => 'resend',
      resolveFrom: () => undefined,
      adminOrigin: 'https://admin.example.test',
      onRefused
    })

    await sender({ ...message, from: '' })

    expect(send).not.toHaveBeenCalled()
    expect(onRefused).toHaveBeenCalledTimes(1)
  })
})
