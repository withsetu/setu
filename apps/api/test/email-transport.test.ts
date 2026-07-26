import { describe, expect, it, vi } from 'vitest'
import type { EmailMessage } from '@setu/core'
import { usableEmailTransport } from '../src/capabilities'
import {
  createEmailDispatcher,
  type ResendConfig
} from '../src/email-transport'

// #890 made the email provider a CONTROL rather than a boot-time env var: the transport is
// re-resolved from settings.json + env per send, so a save in Settings → Email applies to the next
// email with no api restart. This module owns the second half of that — turning a resolution into
// an actual adapter and sending through it.
//
// #959: it no longer owns the FIRST half. `resolve()`, `send()` and the `provider()` getter they
// read settings.json through were unreachable from every production path after #939 gave each send
// path one `EmailConfig` to dispatch from; selection now lives once, in `resolveEmailConfig`. So
// every case below hands `sendVia` a reading made by the REAL `usableEmailTransport` — the same
// function `resolveEmailConfig` calls — rather than asking this module to resolve one. The
// properties that moved with the resolver are pinned where the resolver is
// (apps/api/test/email-config.test.ts: 'keeps the #890 precedence: a stored provider beats
// SETU_EMAIL_ADAPTER', 'keeps the #890 fail-safe: an unusable stored provider degrades to console,
// it does not throw', 'a throwing settings getter degrades to env-only rather than failing the
// send', 're-reads on EVERY call, so a save applies to the next email with no restart').

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
  /** #930: what the resend factory was actually handed — the adapter's own bound is only real if
   *  the parsed config reaches its constructor. */
  const resendConfigs: ResendConfig[] = []
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
    resendConfigs,
    adapters: {
      console: make('console'),
      resend: (config: ResendConfig) => {
        resendConfigs.push(config)
        return make('resend')()
      },
      smtp: (_config: unknown) => make('smtp')()
    }
  }
}

describe('createEmailDispatcher — the resolution names the adapter', () => {
  it('a settings provider beats SETU_EMAIL_ADAPTER for the actual send', async () => {
    const { sent, adapters } = spyAdapters()
    const env = { SETU_EMAIL_ADAPTER: 'console', ...SMTP_ENV }
    const t = createEmailDispatcher({ env, adapters })

    await t.sendVia(usableEmailTransport(env, 'smtp'), MSG)

    expect(sent.smtp).toHaveLength(1)
    expect(sent.console).toHaveLength(0)
  })

  it('no settings provider -> the env var still decides (existing deployments unchanged)', async () => {
    const { sent, adapters } = spyAdapters()
    const env = { SETU_EMAIL_ADAPTER: 'smtp', ...SMTP_ENV }
    const t = createEmailDispatcher({ env, adapters })

    await t.sendVia(usableEmailTransport(env, ''), MSG)

    expect(sent.smtp).toHaveLength(1)
  })

  // The whole point of the seam: no restart. The CALLER re-reads settings per send
  // (createLiveEmailConfig), so two sends through ONE long-lived dispatcher can land on two
  // different adapters — which is only true because no reading is remembered between calls.
  it('two sends through one dispatcher follow two different readings — nothing is frozen', async () => {
    const { sent, built, adapters } = spyAdapters()
    const t = createEmailDispatcher({ env: SMTP_ENV, adapters })

    await t.sendVia(usableEmailTransport(SMTP_ENV, 'console'), MSG)
    await t.sendVia(usableEmailTransport(SMTP_ENV, 'smtp'), {
      ...MSG,
      subject: 'after the switch'
    })

    expect(sent.console.map((m) => m.subject)).toEqual(['hi'])
    expect(sent.smtp.map((m) => m.subject)).toEqual(['after the switch'])
    expect(built).toEqual({ console: 1, resend: 0, smtp: 1 })
  })

  it('adapters are constructed lazily and cached — an unused transport is never built', async () => {
    const { built, adapters } = spyAdapters()
    const env = { RESEND_API_KEY: 'test-fake-key' }
    const t = createEmailDispatcher({ env, adapters })
    expect(built).toEqual({ console: 0, resend: 0, smtp: 0 })

    await t.sendVia(usableEmailTransport(env, 'resend'), MSG)
    await t.sendVia(usableEmailTransport(env, 'resend'), MSG)

    expect(built).toEqual({ console: 0, resend: 1, smtp: 0 })
  })
})

describe('createEmailDispatcher — fail-safe on an unusable stored provider (#890)', () => {
  // KILL-SHOT target. settings.json is Git-canonical: an unusable provider can arrive by
  // `git push`, bypassing the api's settings-write gate entirely, so the point of USE has to
  // degrade rather than trust the stored value. Delete the usability check in
  // usableEmailTransport (or make this module key on `selected` instead of `effective`) and this
  // fails: the resend factory is asked for an adapter it cannot build.
  it('resend chosen in settings with no RESEND_API_KEY: falls back to console, never throws', async () => {
    const { sent, built, adapters } = spyAdapters()
    const problems: string[] = []
    const t = createEmailDispatcher({
      env: {},
      adapters,
      onProblem: (problem) => problems.push(problem)
    })

    const reading = usableEmailTransport({}, 'resend')
    expect(reading).toMatchObject({
      selected: 'resend',
      effective: 'console',
      problem: 'RESEND_API_KEY is unset'
    })
    await expect(t.sendVia(reading, MSG)).resolves.toBeUndefined()
    expect(sent.console).toHaveLength(1)
    expect(built.resend).toBe(0)
    expect(problems[0]).toContain('RESEND_API_KEY is unset')
  })

  it('smtp chosen in settings with no SETU_SMTP_HOST: falls back to console with the reason', async () => {
    const { sent, built, adapters } = spyAdapters()
    const problems: string[] = []
    const t = createEmailDispatcher({
      env: {},
      adapters,
      onProblem: (problem) => problems.push(problem)
    })

    await t.sendVia(usableEmailTransport({}, 'smtp'), MSG)

    expect(sent.console).toHaveLength(1)
    expect(built.smtp).toBe(0)
    expect(problems[0]).toContain('SETU_SMTP_HOST is unset')
  })

  it('an unrecognized stored provider falls back to console', async () => {
    const { sent, adapters } = spyAdapters()
    const t = createEmailDispatcher({ env: {}, adapters })

    await t.sendVia(usableEmailTransport({}, 'sendgrid'), MSG)

    expect(sent.console).toHaveLength(1)
  })
})

describe('createEmailDispatcher — sendVia binds a caller-resolved reading (#919)', () => {
  // The seam an unbound `send` could not offer: a caller that has to DECIDE on a resolution (the
  // reset-email gate) needs the decision and the dispatch to be the same reading. A dispatcher
  // that resolved for itself would make gating and sending two independent readings — a TOCTOU,
  // settings.json being Git-canonical, since a checkout/pull can rewrite it between the two.
  it('dispatches through the resolution it was handed, never a fresh one', async () => {
    const { sent, adapters } = spyAdapters()
    // The env alone would select console; the caller's reading says smtp. Only the reading it was
    // handed can produce an smtp send here.
    const t = createEmailDispatcher({
      env: { SETU_EMAIL_ADAPTER: 'console', ...SMTP_ENV },
      adapters
    })

    await t.sendVia(usableEmailTransport(SMTP_ENV, 'smtp'), MSG)

    expect(sent.smtp).toHaveLength(1)
    expect(sent.console).toEqual([])
  })

  it('still reports the problem carried by the resolution it was handed', async () => {
    const { sent, adapters } = spyAdapters()
    const onProblem = vi.fn()
    const t = createEmailDispatcher({ env: {}, adapters, onProblem })

    await t.sendVia(usableEmailTransport({}, 'resend'), MSG)

    // resend with no key degrades to console — dispatching through a caller's reading must not
    // lose the fail-safe reporting.
    expect(sent.console).toHaveLength(1)
    expect(onProblem).toHaveBeenCalledTimes(1)
    expect(onProblem.mock.calls[0]?.[0]).toContain('RESEND_API_KEY is unset')
  })
})

describe('createEmailDispatcher — the warning is named, and not per-send spam', () => {
  it('reports each distinct problem once, not on every send', async () => {
    const { adapters } = spyAdapters()
    const onProblem = vi.fn()
    const t = createEmailDispatcher({ env: {}, adapters, onProblem })

    await t.sendVia(usableEmailTransport({}, 'resend'), MSG)
    await t.sendVia(usableEmailTransport({}, 'resend'), MSG)
    expect(onProblem).toHaveBeenCalledTimes(1)

    await t.sendVia(usableEmailTransport({}, 'smtp'), MSG)
    expect(onProblem).toHaveBeenCalledTimes(2)
    expect(onProblem.mock.calls[1]?.[0]).toContain('SETU_SMTP_HOST is unset')
  })

  it('says nothing when the selected transport is usable', async () => {
    const { adapters } = spyAdapters()
    const onProblem = vi.fn()
    const t = createEmailDispatcher({ env: SMTP_ENV, adapters, onProblem })

    await t.sendVia(usableEmailTransport(SMTP_ENV, 'smtp'), MSG)

    expect(onProblem).not.toHaveBeenCalled()
  })

  it('re-reports a problem that recurs after the config was fixed in between', async () => {
    const { adapters } = spyAdapters()
    const onProblem = vi.fn()
    const t = createEmailDispatcher({ env: SMTP_ENV, adapters, onProblem })

    await t.sendVia(usableEmailTransport(SMTP_ENV, 'resend'), MSG) // no key -> problem
    await t.sendVia(usableEmailTransport(SMTP_ENV, 'smtp'), MSG) // usable -> clears
    await t.sendVia(usableEmailTransport(SMTP_ENV, 'resend'), MSG) // problem again

    expect(onProblem).toHaveBeenCalledTimes(2)
  })
})

// #930 — the resend adapter's request bound is env-overridable, and this seam is where the parse
// happens (the same shape smtp has used since #256: one parser, called at the point of use, on the
// same env). A bound the operator can set but that never reaches the constructor is not a bound.
describe('createEmailDispatcher — the resend request bound reaches the adapter (#930)', () => {
  const RESEND_ENV = { RESEND_API_KEY: 'test-fake-key' }

  it('hands the resend factory the api key and the parsed timeout override', async () => {
    const { resendConfigs, adapters } = spyAdapters()
    const env = {
      SETU_EMAIL_ADAPTER: 'resend',
      ...RESEND_ENV,
      SETU_RESEND_TIMEOUT_MS: '2500'
    }
    const t = createEmailDispatcher({ env, adapters })

    await t.sendVia(usableEmailTransport(env, ''), MSG)

    expect(resendConfigs).toEqual([
      { apiKey: 'test-fake-key', requestTimeoutMs: 2_500 }
    ])
  })

  it('omits the override when unset, leaving the adapter its own bounded default', async () => {
    const { resendConfigs, adapters } = spyAdapters()
    const env = { SETU_EMAIL_ADAPTER: 'resend', ...RESEND_ENV }
    const t = createEmailDispatcher({ env, adapters })

    await t.sendVia(usableEmailTransport(env, ''), MSG)

    expect(resendConfigs).toEqual([{ apiKey: 'test-fake-key' }])
  })

  it('never builds a resend adapter when the override is broken — it degrades to console', async () => {
    const { sent, built, adapters } = spyAdapters()
    const onProblem = vi.fn()
    const env = {
      SETU_EMAIL_ADAPTER: 'resend',
      ...RESEND_ENV,
      SETU_RESEND_TIMEOUT_MS: 'whenever'
    }
    const t = createEmailDispatcher({ env, adapters, onProblem })

    await t.sendVia(usableEmailTransport(env, ''), MSG)

    expect(built.resend).toBe(0)
    expect(sent.console).toHaveLength(1)
    expect(onProblem).toHaveBeenCalledWith(
      expect.stringContaining('SETU_RESEND_TIMEOUT_MS'),
      'resend'
    )
  })
})
