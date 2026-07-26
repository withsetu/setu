import { describe, expect, it } from 'vitest'
import {
  emailCapabilityFromEnv,
  type FromAddressResolution,
  type UsableEmailTransport
} from '../src/capabilities'
import { buildEmailStatus, type EmailStatusContext } from '../src/email'

/**
 * #938: `GET /api/email/status`'s payload used to be an inline literal in apps/api/src/server.ts,
 * a side-effectful entrypoint no test imports — so the PRODUCTION derivation was unexercised
 * while three hand-written near-copies stood in for it. Dropping `&& from.effective !== null`
 * from that literal failed nothing, and the screen would then say "Ready to send" on an instance
 * with a real transport and no from-address, which is exactly the state
 * `POST /api/email/test-send` answers 409 `no_from_address` on.
 *
 * These drive the extracted `buildEmailStatus` directly. The last describe is the kill-shot
 * target: it fails if either conjunct of `emailDeliverable` is removed.
 */
const transport = (
  over: Partial<UsableEmailTransport> = {}
): UsableEmailTransport => ({
  selected: 'resend',
  source: 'env',
  effective: 'resend',
  problem: null,
  ...over
})

const from = (
  over: Partial<FromAddressResolution> = {}
): FromAddressResolution => ({
  effective: 'site@example.test',
  source: 'settings',
  problem: null,
  ...over
})

const ctx = (over: Partial<EmailStatusContext> = {}): EmailStatusContext => ({
  env: { RESEND_API_KEY: 'k' },
  mode: 'self-hosted',
  resetWiredAtBoot: true,
  authConfigured: true,
  adminOriginPresent: true,
  ...over
})

describe('buildEmailStatus', () => {
  it('reports the resolved selection, its source and the effective adapter verbatim', () => {
    const s = buildEmailStatus(
      {
        from: from(),
        transport: transport({
          selected: 'sendgrid',
          source: 'settings',
          effective: 'console',
          problem: null
        })
      },
      ctx()
    )
    expect(s.transport).toBe('sendgrid')
    expect(s.providerSource).toBe('settings')
    expect(s.effectiveTransport).toBe('console')
    expect(s.mode).toBe('self-hosted')
  })

  it('passes the from-address resolution through, both members', () => {
    const s = buildEmailStatus(
      {
        from: from({ effective: 'env@example.test', source: 'env' }),
        transport: transport()
      },
      ctx()
    )
    // #953: `problem` is part of the public projection — the screen needs to distinguish a
    // REJECTED server from-address from one that was never configured.
    expect(s.from).toEqual({
      effective: 'env@example.test',
      source: 'env',
      problem: null
    })
  })

  it('secrets are presence booleans and a boot-log-safe problem — never key material', () => {
    const s = buildEmailStatus(
      { from: from(), transport: transport() },
      ctx({ env: { RESEND_API_KEY: 'super-secret-value' } })
    )
    expect(s.secrets.resendApiKey).toBe(true)
    expect(JSON.stringify(s)).not.toContain('super-secret-value')
  })

  it('smtpConfigured is selection-INDEPENDENT (#890): the picker must say whether SMTP could be chosen', () => {
    const env = { SETU_SMTP_HOST: '127.0.0.1', SETU_SMTP_PORT: '25' }
    // Selection is resend, yet smtp usability must still be reported for the dropdown.
    const s = buildEmailStatus(
      { from: from(), transport: transport() },
      ctx({ env })
    )
    expect(s.secrets.smtpConfigured).toBe(true)
    expect(s.transports.map((t) => t.id)).toEqual(['console', 'resend', 'smtp'])
  })

  it('smtpProblem is reported only when SMTP is the SELECTED transport', () => {
    const broken = transport({
      selected: 'smtp',
      effective: 'console',
      problem: 'SETU_SMTP_PORT is not a number'
    })
    expect(
      buildEmailStatus({ from: from(), transport: broken }, ctx()).secrets
        .smtpProblem
    ).toBe('SETU_SMTP_PORT is not a number')
    expect(
      buildEmailStatus(
        { from: from(), transport: transport({ problem: 'irrelevant' }) },
        ctx()
      ).secrets.smtpProblem
    ).toBeNull()
  })

  it('resetRestartRequired follows the LIVE reading, not the boot gate alone', () => {
    const notWired = ctx({ resetWiredAtBoot: false })
    expect(
      buildEmailStatus({ from: from(), transport: transport() }, notWired)
        .resetRestartRequired
    ).toBe(true)
    // A restart cannot enable reset while the effective transport is the console adapter (#894).
    expect(
      buildEmailStatus(
        { from: from(), transport: transport({ effective: 'console' }) },
        notWired
      ).resetRestartRequired
    ).toBe(false)
    // …nor without a from-address.
    expect(
      buildEmailStatus(
        {
          from: from({ effective: null, source: null }),
          transport: transport()
        },
        notWired
      ).resetRestartRequired
    ).toBe(false)
  })

  /**
   * The kill-shot target for #938. Each of these fails if the corresponding conjunct is dropped
   * from `emailDeliverable` in apps/api/src/capabilities.ts — which is the mutation the issue
   * reported as surviving every test in the repo.
   */
  describe('deliverable is the SAME predicate /api/capabilities uses', () => {
    it('true only when a real transport AND a from-address are both present', () => {
      expect(
        buildEmailStatus({ from: from(), transport: transport() }, ctx())
          .deliverable
      ).toBe(true)
    })

    it('FALSE with a real transport but no from-address (the drifted copy said true)', () => {
      expect(
        buildEmailStatus(
          {
            from: from({ effective: null, source: null }),
            transport: transport()
          },
          ctx()
        ).deliverable
      ).toBe(false)
    })

    it('FALSE with a from-address but a console-effective transport', () => {
      expect(
        buildEmailStatus(
          { from: from(), transport: transport({ effective: 'console' }) },
          ctx()
        ).deliverable
      ).toBe(false)
    })

    /**
     * The anti-drift assertion proper: for every combination of the two inputs, this route's
     * answer must equal `/api/capabilities`' answer built from the same env + settings. A copy
     * of the expression here — however faithful today — could not fail when only one side
     * changed; this can.
     */
    it('agrees with emailCapabilityFromEnv across every combination of the two inputs', () => {
      const envs = [
        { RESEND_API_KEY: 'k' }, // resend usable
        {} // nothing usable → console
      ]
      const fromAddresses = [undefined, 'site@example.test']
      for (const env of envs)
        for (const fromAddress of fromAddresses) {
          const capability = emailCapabilityFromEnv(env, fromAddress, 'resend')
          const status = buildEmailStatus(
            {
              from: {
                effective: fromAddress ?? null,
                source: fromAddress === undefined ? null : 'settings',
                problem: null
              },
              transport: {
                selected: 'resend',
                source: 'settings',
                effective: env.RESEND_API_KEY ? 'resend' : 'console',
                problem: null
              }
            },
            ctx({ env })
          )
          expect(
            status.deliverable,
            `env=${JSON.stringify(env)} from=${String(fromAddress)}`
          ).toBe(capability.deliverable)
        }
    })
  })
})
