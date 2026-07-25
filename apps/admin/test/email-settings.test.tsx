import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { NotificationProvider } from '../src/ui/notify'
import { EmailSettings } from '../src/screens/settings/EmailSettings'

// #498: Settings → Email — provider status card (honest per-transport copy), from-address
// save flow (settings commit pattern), and the admin-only test send incl. the
// console-transport "logged, not sent" honesty.
// #890: the transport is a CONTROL — a dropdown of all three, with the ones whose secret is
// absent disabled and carrying their own remediation, saved into settings.json's
// `email.provider` alongside the from-address.

// Radix Select needs pointer/scroll APIs jsdom lacks (the demo-data-screen precedent).
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView ??= () => {}
  window.HTMLElement.prototype.hasPointerCapture ??= () => false
  window.HTMLElement.prototype.releasePointerCapture ??= () => {}
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

type TransportId = 'console' | 'resend' | 'smtp'

interface StatusOverrides {
  transport?: string
  providerSource?: 'settings' | 'env' | 'default'
  transports?: { id: TransportId; usable: boolean; problem: string | null }[]
  effectiveTransport?: 'console' | 'resend' | 'smtp'
  deliverable?: boolean
  mode?: string
  from?: { effective: string | null; source: 'settings' | 'env' | null }
  secrets?: {
    resendApiKey: boolean
    smtpConfigured: boolean
    smtpProblem: string | null
  }
  resetRestartRequired?: boolean
}

function consoleStatus(over: StatusOverrides = {}) {
  return {
    transport: 'console',
    providerSource: 'default' as const,
    transports: [
      { id: 'console' as const, usable: true, problem: null },
      {
        id: 'resend' as const,
        usable: false,
        problem:
          'Add RESEND_API_KEY to the server environment to enable Resend.'
      },
      {
        id: 'smtp' as const,
        usable: false,
        problem: 'Add SETU_SMTP_HOST to the server environment to enable SMTP.'
      }
    ],
    effectiveTransport: 'console' as const,
    deliverable: false,
    mode: 'local',
    from: { effective: null, source: null },
    secrets: { resendApiKey: false, smtpConfigured: false, smtpProblem: null },
    resetRestartRequired: false,
    ...over
  }
}

function resendStatus(over: StatusOverrides = {}) {
  return consoleStatus({
    transport: 'resend',
    providerSource: 'env',
    transports: [
      { id: 'console', usable: true, problem: null },
      { id: 'resend', usable: true, problem: null },
      {
        id: 'smtp',
        usable: false,
        problem: 'Add SETU_SMTP_HOST to the server environment to enable SMTP.'
      }
    ],
    effectiveTransport: 'resend',
    deliverable: true,
    mode: 'self-hosted',
    from: { effective: 'noreply@example.com', source: 'env' },
    secrets: { resendApiKey: true, smtpConfigured: false, smtpProblem: null },
    ...over
  })
}

function stubEmailApi(
  status: ReturnType<typeof consoleStatus>,
  testSend: { status: number; body: unknown } = {
    status: 200,
    body: { result: 'sent', transport: 'resend', to: 'admin@test.com' }
  }
) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u =
        typeof url === 'string'
          ? url
          : url instanceof Request
            ? url.url
            : url.toString()
      calls.push({ url: u, method: init?.method ?? 'GET' })
      if (u.includes('/api/email/status')) {
        return new Response(JSON.stringify(status), { status: 200 })
      }
      if (u.includes('/api/email/test-send')) {
        return new Response(JSON.stringify(testSend.body), {
          status: testSend.status
        })
      }
      return new Response('{}', { status: 200 })
    })
  )
  return calls
}

function renderEmail(seed: Record<string, unknown> | null = null) {
  const git = createMemoryGitPort(
    seed === null
      ? []
      : [{ path: 'settings.json', content: JSON.stringify(seed) }]
  )
  const services = servicesFor(createMemoryDataPort([]), git)
  const wrapper = (children: ReactNode) => (
    <NotificationProvider>
      <ActorProvider>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
  render(wrapper(<EmailSettings />))
  return { git }
}

describe('EmailSettings — provider status card', () => {
  it('console transport: named honestly, with the "logged, not sent" copy', async () => {
    stubEmailApi(consoleStatus())
    renderEmail()
    const picker = await screen.findByRole('combobox', { name: /provider/i })
    expect(picker.textContent).toContain('Console (dev)')
    expect(
      screen.getByText(/logged.*not.*sent|logged to the api server/i)
    ).toBeTruthy()
  })

  it('resend with the API key present: presence-only ✓, never a value', async () => {
    stubEmailApi(resendStatus())
    renderEmail()
    const picker = await screen.findByRole('combobox', { name: /provider/i })
    expect(picker.textContent).toContain('Resend')
    expect(screen.getByText(/RESEND_API_KEY.*set via env/i)).toBeTruthy()
    expect(screen.getByText(/ready to send/i)).toBeTruthy()
  })

  // #885 review Finding 2: this stub is EXACTLY what the server derives for
  // SETU_EMAIL_ADAPTER=resend with no RESEND_API_KEY (usableEmailTransport falls back to
  // console, deliverable false even with a from-address) — not an invented state (#638).
  it('resend with the API key missing: honest red ✗ + console fallback, and NO "Ready to send"', async () => {
    stubEmailApi(
      resendStatus({
        effectiveTransport: 'console',
        deliverable: false,
        from: { effective: 'owner@example.com', source: 'settings' },
        secrets: {
          resendApiKey: false,
          smtpConfigured: false,
          smtpProblem: null
        }
      })
    )
    renderEmail()
    expect(await screen.findByText(/RESEND_API_KEY.*missing/i)).toBeTruthy()
    expect(
      screen.getByText(/resend is selected but its api key is missing/i)
    ).toBeTruthy()
    expect(screen.queryByText(/ready to send/i)).toBeNull()
  })

  // #885 review Finding 1: the reset ENABLE gate is boot-frozen — when the from-address
  // arrived after boot, the card must say a restart is needed instead of implying reset
  // already works.
  it('resetRestartRequired: shows the explicit "after the server restarts" line (and hides it otherwise)', async () => {
    stubEmailApi(resendStatus({ resetRestartRequired: true }))
    renderEmail()
    expect(
      await screen.findByText(
        /password reset emails will start working after the server restarts/i
      )
    ).toBeTruthy()
  })

  it('resetRestartRequired false: no restart line', async () => {
    stubEmailApi(resendStatus())
    renderEmail()
    await screen.findByRole('combobox', { name: /provider/i })
    expect(screen.queryByText(/after the server restarts/i)).toBeNull()
  })

  it('smtp selected but unusable: shows the reason and the console fallback', async () => {
    stubEmailApi(
      consoleStatus({
        transport: 'smtp',
        mode: 'self-hosted',
        secrets: {
          resendApiKey: false,
          smtpConfigured: false,
          smtpProblem: 'SETU_SMTP_HOST is unset'
        }
      })
    )
    renderEmail()
    expect(await screen.findByText(/SETU_SMTP_HOST is unset/)).toBeTruthy()
  })

  // #890: the transport line is a CONTROL, not a label — the owner's UAT question was "why
  // can't the admin switch the email system?".
  it('renders the provider as a dropdown showing the transport currently in use', async () => {
    stubEmailApi(resendStatus())
    renderEmail()
    const picker = await screen.findByRole('combobox', { name: /provider/i })
    expect(picker.textContent).toContain('Resend')
  })

  it('offers all three transports; the ones whose secret is missing are disabled and say what to add', async () => {
    stubEmailApi(consoleStatus()) // console-only env: no RESEND_API_KEY, no SETU_SMTP_HOST
    renderEmail()
    fireEvent.click(await screen.findByRole('combobox', { name: /provider/i }))

    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(3)

    const resend = screen.getByRole('option', { name: /^Resend/ })
    const smtp = screen.getByRole('option', { name: /^SMTP/ })
    const console_ = screen.getByRole('option', { name: /^Console/ })
    expect(resend).toHaveAttribute('aria-disabled', 'true')
    expect(smtp).toHaveAttribute('aria-disabled', 'true')
    // Console needs no secret, so the picker can never have zero selectable options.
    expect(console_).not.toHaveAttribute('aria-disabled', 'true')
    expect(resend.textContent).toContain(
      'Add RESEND_API_KEY to the server environment to enable Resend.'
    )
    expect(smtp.textContent).toContain(
      'Add SETU_SMTP_HOST to the server environment to enable SMTP.'
    )
  })

  it('a usable transport is selectable even when it is not the current one', async () => {
    stubEmailApi(
      consoleStatus({
        transports: [
          { id: 'console', usable: true, problem: null },
          { id: 'resend', usable: false, problem: 'Add RESEND_API_KEY…' },
          { id: 'smtp', usable: true, problem: null }
        ]
      })
    )
    renderEmail()
    fireEvent.click(await screen.findByRole('combobox', { name: /provider/i }))
    expect(screen.getByRole('option', { name: /^SMTP/ })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('names the environment as the current source when SETU_EMAIL_ADAPTER is what chose the transport', async () => {
    stubEmailApi(resendStatus({ providerSource: 'env' }))
    renderEmail()
    expect(await screen.findByText(/SETU_EMAIL_ADAPTER variable/i)).toBeTruthy()
  })

  it('a failed status fetch shows an error state with a retry, not an eternal skeleton', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      })
    )
    renderEmail()
    expect(
      await screen.findByText(/couldn.t load email delivery status/i)
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })
})

describe('EmailSettings — from-address save flow', () => {
  it('saves the email group and preserves unknown settings groups', async () => {
    stubEmailApi(consoleStatus())
    const { git } = renderEmail({
      general: { title: 'Kept' },
      futureGroup: { some: 'value' }
    })
    const input = await screen.findByLabelText(/from address/i)
    fireEvent.change(input, { target: { value: 'owner@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw as string) as Record<string, unknown>
      expect((parsed.email as { fromAddress: string }).fromAddress).toBe(
        'owner@example.com'
      )
      expect(parsed.futureGroup).toEqual({ some: 'value' })
      expect((parsed.general as { title: string }).title).toBe('Kept')
    })
  })

  // #885 review Finding 4: parseSettings passes unknown keys INSIDE the email group through
  // (e.g. #499's future template keys) — a save must not drop them.
  it('a passthrough key inside the email group survives a save', async () => {
    stubEmailApi(consoleStatus())
    const { git } = renderEmail({
      email: {
        fromAddress: 'old@example.com',
        futureTemplates: { reset: 'hi' }
      }
    })
    const input = await screen.findByLabelText(/from address/i)
    await waitFor(() =>
      expect((input as HTMLInputElement).value).toBe('old@example.com')
    )
    fireEvent.change(input, { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      const email = (JSON.parse(raw as string) as Record<string, unknown>)
        .email as Record<string, unknown>
      expect(email.fromAddress).toBe('new@example.com')
      expect(email.futureTemplates).toEqual({ reset: 'hi' })
    })
  })

  // #885 review Finding 6: whitespace padding is not a change — trimmed before dirty-compare
  // and before saving.
  it('padding the published value with whitespace does not arm Save; a padded new value saves trimmed', async () => {
    stubEmailApi(consoleStatus())
    const { git } = renderEmail({ email: { fromAddress: 'a@b.co' } })
    const input = await screen.findByLabelText(/from address/i)
    await waitFor(() =>
      expect((input as HTMLInputElement).value).toBe('a@b.co')
    )

    fireEvent.change(input, { target: { value: '  a@b.co  ' } })
    // Not dirty: the button stays in its "Saved" resting state.
    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy()

    fireEvent.change(input, { target: { value: '  owner@example.com  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      expect(
        (JSON.parse(raw as string).email as { fromAddress: string }).fromAddress
      ).toBe('owner@example.com')
    })
  })

  it('rejects an invalid address with a per-field error and commits nothing', async () => {
    stubEmailApi(consoleStatus())
    const { git } = renderEmail()
    const input = await screen.findByLabelText(/from address/i)
    fireEvent.change(input, { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/valid email/i)).toBeTruthy()
    expect(await git.readFile('settings.json')).toBeNull()
  })

  it('Enter in the field submits (form save), like every other settings screen', async () => {
    stubEmailApi(consoleStatus())
    const { git } = renderEmail()
    const input = await screen.findByLabelText(/from address/i)
    fireEvent.change(input, { target: { value: 'owner@example.com' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      expect(
        (JSON.parse(raw as string).email as { fromAddress: string }).fromAddress
      ).toBe('owner@example.com')
    })
  })
})

describe('EmailSettings — provider save flow (#890)', () => {
  const bothUsable = {
    transports: [
      { id: 'console' as const, usable: true, problem: null },
      { id: 'resend' as const, usable: true, problem: null },
      { id: 'smtp' as const, usable: true, problem: null }
    ]
  }

  async function pickProvider(name: RegExp) {
    fireEvent.click(await screen.findByRole('combobox', { name: /provider/i }))
    fireEvent.click(await screen.findByRole('option', { name }))
  }

  it('choosing a provider arms Save and commits email.provider to settings.json', async () => {
    stubEmailApi(consoleStatus(bothUsable))
    const { git } = renderEmail({ general: { title: 'Kept' } })
    await screen.findByRole('combobox', { name: /provider/i })
    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy()

    await pickProvider(/^SMTP/)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw as string) as Record<string, unknown>
      expect((parsed.email as { provider: string }).provider).toBe('smtp')
      expect((parsed.general as { title: string }).title).toBe('Kept')
    })
  })

  it('says the choice is not applied until saved, then re-reads the live status after saving', async () => {
    const calls = stubEmailApi(consoleStatus(bothUsable))
    renderEmail()
    await pickProvider(/^Resend/)
    expect(screen.getByText(/not applied yet/i)).toBeTruthy()

    const before = calls.filter((c) =>
      c.url.includes('/api/email/status')
    ).length
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      const after = calls.filter((c) =>
        c.url.includes('/api/email/status')
      ).length
      expect(after).toBeGreaterThan(before)
    })
    expect(screen.queryByText(/not applied yet/i)).toBeNull()
  })

  it('a provider change and a from-address edit save together, in one commit', async () => {
    stubEmailApi(consoleStatus(bothUsable))
    const { git } = renderEmail()
    await pickProvider(/^SMTP/)
    fireEvent.change(await screen.findByLabelText(/from address/i), {
      target: { value: 'owner@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw as string).email).toMatchObject({
        provider: 'smtp',
        fromAddress: 'owner@example.com'
      })
    })
  })

  it('a passthrough key inside the email group survives a provider-only save', async () => {
    stubEmailApi(consoleStatus(bothUsable))
    const { git } = renderEmail({
      email: { fromAddress: 'a@b.co', futureTemplates: { reset: 'hi' } }
    })
    await pickProvider(/^Resend/)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      const email = (JSON.parse(raw as string) as Record<string, unknown>)
        .email as Record<string, unknown>
      expect(email.provider).toBe('resend')
      expect(email.fromAddress).toBe('a@b.co')
      expect(email.futureTemplates).toEqual({ reset: 'hi' })
    })
  })

  // The stored provider is what the picker shows, even when the environment names another one:
  // settings win (apps/api/src/capabilities.ts's resolveEmailProvider), and the screen must not
  // imply otherwise.
  it('shows the stored provider, not the env-derived one, when settings.json has a choice', async () => {
    stubEmailApi(
      resendStatus({
        ...bothUsable,
        transport: 'smtp',
        providerSource: 'settings'
      })
    )
    renderEmail({ email: { provider: 'smtp' } })
    const picker = await screen.findByRole('combobox', { name: /provider/i })
    await waitFor(() => expect(picker.textContent).toContain('SMTP'))
    expect(screen.getByText(/chosen here, in settings/i)).toBeTruthy()
  })
})

describe('EmailSettings — test send', () => {
  it('sent: POSTs the endpoint and reports the recipient', async () => {
    const calls = stubEmailApi(resendStatus(), {
      status: 200,
      body: { result: 'sent', transport: 'resend', to: 'admin@test.com' }
    })
    renderEmail()
    const btn = await screen.findByRole('button', { name: /send test email/i })
    fireEvent.click(btn)
    expect(await screen.findByText(/sent to admin@test\.com/i)).toBeTruthy()
    expect(
      calls.some(
        (c) => c.url.includes('/api/email/test-send') && c.method === 'POST'
      )
    ).toBe(true)
  })

  it('console transport: reports "logged", never pretends it was delivered', async () => {
    stubEmailApi(
      consoleStatus({
        from: { effective: 'owner@example.com', source: 'settings' }
      }),
      {
        status: 200,
        body: { result: 'logged', transport: 'console', to: 'admin@test.com' }
      }
    )
    renderEmail()
    fireEvent.click(
      await screen.findByRole('button', { name: /send test email/i })
    )
    expect(
      await screen.findByText(
        /logged to the api server console.*nothing was delivered/i
      )
    ).toBeTruthy()
  })

  it('409 (no from-address) surfaces the server message as an error', async () => {
    stubEmailApi(consoleStatus(), {
      status: 409,
      body: {
        error: 'no_from_address',
        message: 'No from-address is configured — set one below.'
      }
    })
    renderEmail()
    fireEvent.click(
      await screen.findByRole('button', { name: /send test email/i })
    )
    expect(
      await screen.findByText(/no from-address is configured/i)
    ).toBeTruthy()
  })

  it('429 rate limit surfaces an honest "try again in a minute"', async () => {
    stubEmailApi(resendStatus(), {
      status: 429,
      body: { error: 'rate_limited', retryAfterMs: 60000 }
    })
    renderEmail()
    fireEvent.click(
      await screen.findByRole('button', { name: /send test email/i })
    )
    expect(await screen.findByText(/wait a minute/i)).toBeTruthy()
  })

  it('502 failure surfaces the reason', async () => {
    stubEmailApi(resendStatus(), {
      status: 502,
      body: { error: 'send_failed', reason: 'connect ECONNREFUSED' }
    })
    renderEmail()
    fireEvent.click(
      await screen.findByRole('button', { name: /send test email/i })
    )
    expect(await screen.findByText(/ECONNREFUSED/)).toBeTruthy()
  })
})
