import { describe, expect, it, vi } from 'vitest'
import type { EmailMessage } from '@setu/core'
import { createLiveEmailTransport } from '../src/email-transport'

// #890: the live adapter seam. Increment A (#498) constructed ONE adapter at boot from
// SETU_EMAIL_ADAPTER, so the provider could not be a control — switching it in the admin would
// have needed an api restart. This module re-resolves the transport per send (the same
// live-getter pattern the from-address already uses), which is what makes the dropdown real.

const MSG: EmailMessage = {
  to: 'admin@example.com',
  from: 'noreply@example.com',
  subject: 'hi',
  html: '<p>hi</p>'
}

const SMTP_ENV = { SETU_SMTP_HOST: '127.0.0.1', SETU_SMTP_PORT: '11025' }

/** Spy factories in place of the real console/resend/smtp adapters — the module under test
 *  never imports a concrete adapter (server.ts injects them), so these ARE the seam, not a
 *  stand-in for it. Each records the messages it was asked to send and how many times it was
 *  constructed. */
type Kind = 'console' | 'resend' | 'smtp'

function spyAdapters() {
  const sent: { [K in Kind]: EmailMessage[] } = {
    console: [],
    resend: [],
    smtp: []
  }
  const built: { [K in Kind]: number } = { console: 0, resend: 0, smtp: 0 }
  const make = (kind: Kind) => () => {
    built[kind] += 1
    return {
      send: async (msg: EmailMessage) => {
        sent[kind].push(msg)
      }
    }
  }
  return {
    sent,
    built,
    adapters: {
      console: make('console'),
      resend: (_apiKey: string) => make('resend')(),
      smtp: (_config: unknown) => make('smtp')()
    }
  }
}

describe('createLiveEmailTransport — the settings-chosen provider selects the adapter', () => {
  it('a settings provider beats SETU_EMAIL_ADAPTER for the actual send', async () => {
    const { sent, adapters } = spyAdapters()
    const t = createLiveEmailTransport({
      env: { SETU_EMAIL_ADAPTER: 'console', ...SMTP_ENV },
      provider: () => 'smtp',
      adapters
    })
    await t.send(MSG)
    expect(sent.smtp).toHaveLength(1)
    expect(sent.console).toHaveLength(0)
    expect(t.resolve()).toMatchObject({
      selected: 'smtp',
      source: 'settings',
      effective: 'smtp'
    })
  })

  it('no settings provider -> the env var still decides (existing deployments unchanged)', async () => {
    const { sent, adapters } = spyAdapters()
    const t = createLiveEmailTransport({
      env: { SETU_EMAIL_ADAPTER: 'smtp', ...SMTP_ENV },
      provider: () => '',
      adapters
    })
    await t.send(MSG)
    expect(sent.smtp).toHaveLength(1)
    expect(t.resolve().source).toBe('env')
  })

  // The whole point of the seam: no restart. The provider getter re-reads settings.json, so a
  // save between two sends changes where the SECOND one goes.
  it('a provider change between sends applies immediately — no restart, no re-construction', async () => {
    const { sent, built, adapters } = spyAdapters()
    let provider = 'console'
    const t = createLiveEmailTransport({
      env: SMTP_ENV,
      provider: () => provider,
      adapters
    })
    await t.send(MSG)
    provider = 'smtp'
    await t.send({ ...MSG, subject: 'after the switch' })

    expect(sent.console.map((m) => m.subject)).toEqual(['hi'])
    expect(sent.smtp.map((m) => m.subject)).toEqual(['after the switch'])
    expect(built).toEqual({ console: 1, resend: 0, smtp: 1 })
  })

  it('adapters are constructed lazily and cached — an unused transport is never built', async () => {
    const { built, adapters } = spyAdapters()
    const t = createLiveEmailTransport({
      env: { RESEND_API_KEY: 'test-fake-key' },
      provider: () => 'resend',
      adapters
    })
    expect(built).toEqual({ console: 0, resend: 0, smtp: 0 })
    await t.send(MSG)
    await t.send(MSG)
    expect(built).toEqual({ console: 0, resend: 1, smtp: 0 })
  })
})

describe('createLiveEmailTransport — fail-safe on an unusable stored provider (#890)', () => {
  // KILL-SHOT target. settings.json is Git-canonical: an unusable provider can arrive by
  // `git push`, bypassing the api's settings-write gate entirely, so the point of USE has to
  // degrade rather than trust the stored value. Delete the usability check in
  // usableEmailTransport (or make createLiveEmailTransport key on `selected` instead of
  // `effective`) and this fails: the resend factory is asked for an adapter it cannot build.
  it('resend chosen in settings with no RESEND_API_KEY: falls back to console, never throws', async () => {
    const { sent, built, adapters } = spyAdapters()
    const problems: string[] = []
    const t = createLiveEmailTransport({
      env: {},
      provider: () => 'resend',
      adapters,
      onProblem: (problem) => problems.push(problem)
    })

    await expect(t.send(MSG)).resolves.toBeUndefined()
    expect(sent.console).toHaveLength(1)
    expect(built.resend).toBe(0)
    expect(t.resolve()).toMatchObject({
      selected: 'resend',
      effective: 'console',
      problem: 'RESEND_API_KEY is unset'
    })
    expect(problems[0]).toContain('RESEND_API_KEY is unset')
  })

  it('smtp chosen in settings with no SETU_SMTP_HOST: falls back to console with the reason', async () => {
    const { sent, built, adapters } = spyAdapters()
    const problems: string[] = []
    const t = createLiveEmailTransport({
      env: {},
      provider: () => 'smtp',
      adapters,
      onProblem: (problem) => problems.push(problem)
    })
    await t.send(MSG)
    expect(sent.console).toHaveLength(1)
    expect(built.smtp).toBe(0)
    expect(problems[0]).toContain('SETU_SMTP_HOST is unset')
  })

  it('an unrecognized stored provider falls back to console', async () => {
    const { sent, adapters } = spyAdapters()
    const t = createLiveEmailTransport({
      env: {},
      provider: () => 'sendgrid',
      adapters
    })
    await t.send(MSG)
    expect(sent.console).toHaveLength(1)
  })

  it('a provider getter that throws (unreadable settings.json) degrades to the env selection', async () => {
    const { sent, adapters } = spyAdapters()
    const t = createLiveEmailTransport({
      env: { SETU_EMAIL_ADAPTER: 'smtp', ...SMTP_ENV },
      provider: () => {
        throw new Error('settings.json is unreadable')
      },
      adapters
    })
    await t.send(MSG)
    expect(sent.smtp).toHaveLength(1)
  })
})

describe('createLiveEmailTransport — sendVia binds a caller-resolved reading (#919)', () => {
  // The seam `send` alone could not offer: a caller that has to DECIDE on a resolution (the
  // reset-email gate) needs the decision and the dispatch to be the same reading. `send`
  // re-resolves internally, so gating on `resolve()` and then calling `send` is a TOCTOU —
  // settings.json is Git-canonical and a checkout/pull can rewrite it between the two.
  it('dispatches through the resolution it was handed, without re-resolving', async () => {
    const { sent, adapters } = spyAdapters()
    let provider = 'smtp'
    const t = createLiveEmailTransport({
      env: SMTP_ENV,
      provider: () => provider,
      adapters
    })

    const resolved = t.resolve()
    // The flip the gate must not be exposed to: it lands AFTER the caller resolved.
    provider = 'console'
    await t.sendVia(resolved, MSG)

    expect(sent.smtp).toHaveLength(1)
    expect(sent.console).toEqual([])
  })

  it('still reports the problem carried by the resolution it was handed', async () => {
    const { sent, adapters } = spyAdapters()
    const onProblem = vi.fn()
    const t = createLiveEmailTransport({
      env: {},
      provider: () => 'resend',
      adapters,
      onProblem
    })

    await t.sendVia(t.resolve(), MSG)

    // resend with no key degrades to console — sendVia must not lose the fail-safe reporting
    // that `send` does.
    expect(sent.console).toHaveLength(1)
    expect(onProblem).toHaveBeenCalledTimes(1)
    expect(onProblem.mock.calls[0]?.[0]).toContain('RESEND_API_KEY is unset')
  })

  it('send is sendVia over a fresh resolution — still live per call', async () => {
    const { sent, adapters } = spyAdapters()
    let provider = 'console'
    const t = createLiveEmailTransport({
      env: SMTP_ENV,
      provider: () => provider,
      adapters
    })

    await t.send(MSG)
    provider = 'smtp'
    await t.send(MSG)

    expect(sent.console).toHaveLength(1)
    expect(sent.smtp).toHaveLength(1)
  })
})

describe('createLiveEmailTransport — the warning is named, and not per-send spam', () => {
  it('reports each distinct problem once, not on every send', async () => {
    const { adapters } = spyAdapters()
    const onProblem = vi.fn()
    let provider = 'resend'
    const t = createLiveEmailTransport({
      env: {},
      provider: () => provider,
      adapters,
      onProblem
    })
    await t.send(MSG)
    await t.send(MSG)
    expect(onProblem).toHaveBeenCalledTimes(1)

    provider = 'smtp'
    await t.send(MSG)
    expect(onProblem).toHaveBeenCalledTimes(2)
    expect(onProblem.mock.calls[1]?.[0]).toContain('SETU_SMTP_HOST is unset')
  })

  it('says nothing when the selected transport is usable', async () => {
    const { adapters } = spyAdapters()
    const onProblem = vi.fn()
    const t = createLiveEmailTransport({
      env: SMTP_ENV,
      provider: () => 'smtp',
      adapters,
      onProblem
    })
    await t.send(MSG)
    expect(onProblem).not.toHaveBeenCalled()
  })

  it('re-reports a problem that recurs after the config was fixed in between', async () => {
    const { adapters } = spyAdapters()
    const onProblem = vi.fn()
    let provider = 'resend'
    const t = createLiveEmailTransport({
      env: SMTP_ENV,
      provider: () => provider,
      adapters,
      onProblem
    })
    await t.send(MSG) // resend, no key -> problem
    provider = 'smtp'
    await t.send(MSG) // usable -> clears
    provider = 'resend'
    await t.send(MSG) // problem again -> reported again
    expect(onProblem).toHaveBeenCalledTimes(2)
  })
})
