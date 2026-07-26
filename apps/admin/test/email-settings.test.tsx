import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { parseSettingsWithWarnings } from '@setu/core'
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
  from?: {
    effective: string | null
    source: 'settings' | 'env' | null
    problem: string | null
  }
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
    from: { effective: null, source: null, problem: null },
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
    from: { effective: 'noreply@example.com', source: 'env', problem: null },
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
        from: {
          effective: 'owner@example.com',
          source: 'settings',
          problem: null
        },
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

  // #953: #942 made a malformed SETU_FORMS_NOTIFY_FROM resolve to null, which is the right gate
  // behaviour but turned this row's fallback copy into an affirmative falsehood — it said the
  // variable was not set while the server had it set and had rejected it. The stub is exactly
  // what resolveFromAddress + publicFrom produce for that env (effective null, source null, a
  // problem naming the variable), not an invented state (#638).
  it('a REJECTED server from-address is named as rejected, never reported as "not set"', async () => {
    stubEmailApi(
      consoleStatus({
        from: {
          effective: null,
          source: null,
          problem:
            'SETU_FORMS_NOTIFY_FROM is set on the server but is not a valid email address, so it is ignored and no from-address is configured'
        }
      })
    )
    renderEmail()
    expect(
      await screen.findByText(/SETU_FORMS_NOTIFY_FROM is set on the server/i)
    ).toBeTruthy()
    expect(screen.getByText(/set on the server, but not usable/i)).toBeTruthy()
    // The old copy claimed the opposite of the truth — it must be gone, not merely joined.
    expect(screen.queryByText(/not set — add one below/i)).toBeNull()
  })

  it('an actually-unset from-address still gets the plain "not set" copy, with no red line', async () => {
    stubEmailApi(consoleStatus())
    renderEmail()
    expect(await screen.findByText(/not set — add one below/i)).toBeTruthy()
    expect(
      screen.queryByText(/SETU_FORMS_NOTIFY_FROM is set on the server/i)
    ).toBeNull()
    // "with no red line" is in the title, so it has to be in the assertions: the previous
    // version passed with the guard mutated to `true`, which renders the destructive paragraph
    // with an EMPTY reason over an install where nothing was ever configured.
    expect(screen.queryByText(/Emails have no sender/i)).toBeNull()
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

  // Radix portals an option's `ItemText` into the CLOSED trigger to display the current value, so
  // a per-option description nested inside ItemText would also render in the trigger. The
  // description is deliberately a sibling of ItemText (apps/admin/src/components/ui/select.tsx) —
  // this asserts the separation instead of just claiming it.
  it('the per-option description never leaks into the trigger', async () => {
    stubEmailApi(consoleStatus())
    renderEmail()
    const picker = await screen.findByRole('combobox', { name: /provider/i })
    expect(picker.textContent).toContain('Console (dev)')
    expect(picker.textContent).not.toContain('Logs emails to')
    expect(picker.textContent).not.toContain('RESEND_API_KEY')
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

    // Radix sets an item's `aria-labelledby` to its ItemText id ALONE, so the remediation is not
    // part of the accessible NAME — asserting `textContent` here would pass while a screen reader
    // announced only "Resend, dimmed". It has to be reachable as the accessible DESCRIPTION.
    expect(resend).toHaveAccessibleName('Resend')
    expect(resend).toHaveAccessibleDescription(
      'Add RESEND_API_KEY to the server environment to enable Resend.'
    )
    expect(smtp).toHaveAccessibleDescription(
      'Add SETU_SMTP_HOST to the server environment to enable SMTP.'
    )
    // Usable options describe what they do, so the description is never an empty promise.
    expect(console_).toHaveAccessibleDescription(
      /logs emails to the api server console/i
    )

    // The LABEL span carries the slot the item's layout selectors target, and the description is
    // a separate node. Without the slot the `*:data-[slot=select-item-text]:*` trio matches
    // nothing and an option rendering `<Icon /> Label` loses its alignment — jsdom can't see the
    // CSS, so the selector's target is what's assertable here.
    const label = resend.querySelector('[data-slot="select-item-text"]')
    expect(label?.textContent).toBe('Resend')
    expect(
      resend.querySelector('[data-slot="select-item-description"]')
    ).not.toBeNull()
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

  // #937: the screen loads the SALVAGED email group, so writing it back whole ERASED every
  // stored value salvage had rejected — from Git, the canonical store — as a side effect of an
  // unrelated from-address change, under "Settings saved". Both of these arrive by `git push`,
  // which never passes the api's settings-write gate; the namespaced template id is the #302
  // plugin case. Driven through the real save button, not the helper (which has its own
  // per-branch coverage in apps/admin/test/email-settings-patch.test.ts).
  it('a from-address save does not erase stored values the salvage layer rejected', async () => {
    stubEmailApi(consoleStatus())
    const { git } = renderEmail({
      email: {
        fromAddress: 'old@example.com',
        provider: 'sendgrid',
        templates: { 'myplugin:welcome': { subject: 'Hi' } }
      }
    })
    const input = await screen.findByLabelText(/from address/i)
    await waitFor(() =>
      expect((input as HTMLInputElement).value).toBe('old@example.com')
    )
    fireEvent.change(input, { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      const email = (JSON.parse(raw as string) as Record<string, unknown>)
        .email as Record<string, unknown>
      expect(email.fromAddress).toBe('new@example.com')
      expect(email.provider).toBe('sendgrid')
      expect(email.templates).toEqual({ 'myplugin:welcome': { subject: 'Hi' } })
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

  // #957: the field's own schema was `z.string().email()` over the WHOLE value, so it refused the
  // display-name form that `SETU_FORMS_NOTIFY_FROM` accepts and both transports document — an
  // operator moving a working env var into Settings was told their address was invalid.
  it('accepts a from-address with a display name', async () => {
    stubEmailApi(consoleStatus())
    const { git } = renderEmail()
    const input = await screen.findByLabelText(/from address/i)
    fireEvent.change(input, { target: { value: 'Setu <hello@example.com>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      const stored = (
        JSON.parse(raw as string).email as { fromAddress: string }
      ).fromAddress
      // The display name survives: storing the bare address would silently rewrite the config.
      expect(stored).toBe('Setu <hello@example.com>')
      // And it round-trips the salvage layer with no warning, so the site reads back what was typed.
      expect(
        parseSettingsWithWarnings(JSON.parse(raw as string)).warnings.filter(
          (w) => w.startsWith('email.fromAddress')
        )
      ).toEqual([])
    })
  })

  // The other half of the widened rule: a display name is not a free pass. A malformed addr-spec
  // inside the brackets is still refused, so accepting `Setu <…>` did not become accepting anything
  // with angle brackets in it.
  it('still rejects a display-name form whose address is malformed', async () => {
    stubEmailApi(consoleStatus())
    const { git } = renderEmail()
    const input = await screen.findByLabelText(/from address/i)
    fireEvent.change(input, { target: { value: 'Setu <not-an-address>' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText(/valid email/i)).toBeTruthy()
    expect(await git.readFile('settings.json')).toBeNull()
  })

  /**
   * Where the header-injection guard is NOT tested, and why — so the next reader does not add a
   * CR/LF case here and take the green as coverage.
   *
   * A `<input type="text">` value cannot contain a CR or LF: the HTML value sanitization algorithm
   * strips them, and jsdom implements that (asserted below rather than asserted about). So the field
   * is structurally incapable of producing the injection value, and a test that "proves" the field
   * rejects one is really testing the sanitizer.
   *
   * The guard's real surfaces are the two that take a string from outside a form control, and both
   * are pinned: the STORED value, which arrives by `git push` into a Git-canonical settings.json —
   * packages/core/src/settings/from-address.test.ts ("drops a stored from-address carrying a control
   * character") — and the ENV var, apps/api/test/capabilities.test.ts.
   */
  it('cannot carry a CR/LF into the field at all — the browser strips them first', async () => {
    stubEmailApi(consoleStatus())
    renderEmail()
    const input = await screen.findByLabelText(/from address/i)
    fireEvent.change(input, {
      target: { value: 'Setu\r\nBcc: evil@example.com <hello@example.com>' }
    })
    expect((input as HTMLInputElement).value).toBe(
      'SetuBcc: evil@example.com <hello@example.com>'
    )
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
        from: {
          effective: 'owner@example.com',
          source: 'settings',
          problem: null
        }
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
