import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within
} from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  EMAIL_TYPES,
  renderEmailTemplate,
  EMAIL_TEMPLATE_MAX_BODY,
  PASSWORD_RESET_EMAIL
} from '@setu/core'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { NotificationProvider } from '../src/ui/notify'
import { EmailSettings } from '../src/screens/settings/EmailSettings'

// #499 (epic #497): the template editor inside Settings → Email. The load-bearing property is
// PREVIEW PARITY — the preview is rendered by @setu/core's renderEmailTemplate, the same
// function the server calls per send, so it cannot disagree with the mail that goes out.

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView ??= () => {}
  window.HTMLElement.prototype.hasPointerCapture ??= () => false
  window.HTMLElement.prototype.releasePointerCapture ??= () => {}
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

const STATUS = {
  transport: 'console',
  providerSource: 'default' as const,
  transports: [
    { id: 'console' as const, usable: true, problem: null },
    { id: 'resend' as const, usable: false, problem: 'Add RESEND_API_KEY.' },
    { id: 'smtp' as const, usable: false, problem: 'Add SETU_SMTP_HOST.' }
  ],
  effectiveTransport: 'console' as const,
  deliverable: false,
  mode: 'local',
  from: { effective: null, source: null },
  secrets: { resendApiKey: false, smtpConfigured: false, smtpProblem: null },
  resetRestartRequired: false
}

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      const u =
        typeof url === 'string'
          ? url
          : url instanceof Request
            ? url.url
            : url.toString()
      if (u.includes('/api/email/status'))
        return new Response(JSON.stringify(STATUS), { status: 200 })
      return new Response('{}', { status: 200 })
    })
  )
}

function renderEmail(
  seed: Record<string, unknown> | null = null,
  opts: { readOnly?: boolean } = {}
) {
  const git = createMemoryGitPort(
    seed === null
      ? []
      : [{ path: 'settings.json', content: JSON.stringify(seed) }]
  )
  const services = servicesFor(createMemoryDataPort([]), git)
  const wrapper = (children: ReactNode) => (
    <NotificationProvider>
      <ActorProvider>
        <ServicesProvider services={services}>
          {/* Settings.tsx wraps every group in this fieldset — disabled for a maintainer
              (settings.view but not settings.manage). Rendering it here is how the read-only
              case is exercised without duplicating the shell. */}
          <fieldset disabled={opts.readOnly === true}>{children}</fieldset>
        </ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
  render(wrapper(<EmailSettings />))
  return { git }
}

/** The template card for a type, by its accessible region name. */
const card = (label: string) => screen.getByRole('region', { name: label })

const subjectFor = (label: string) =>
  within(card(label)).getByLabelText<HTMLInputElement>(/subject/i)
const bodyFor = (label: string) =>
  within(card(label)).getByLabelText<HTMLTextAreaElement>(/body/i)
const previewFrame = (label: string) =>
  within(card(label)).getByTitle<HTMLIFrameElement>(/html preview/i)

const seedWith = (templates: Record<string, unknown>) => ({
  email: { fromAddress: 'a@b.co', templates }
})

describe('EmailSettings — template editor', () => {
  it('renders one card per registered email type, with its description', async () => {
    stubApi()
    renderEmail()
    for (const def of EMAIL_TYPES.list()) {
      const region = await screen.findByRole('region', { name: def.label })
      expect(within(region).getByText(def.description)).toBeTruthy()
    }
  })

  it('shows the shipped default in the fields when nothing is stored', async () => {
    stubApi()
    renderEmail()
    await waitFor(() =>
      expect(subjectFor('Password reset').value).toBe(
        PASSWORD_RESET_EMAIL.defaultSubject
      )
    )
    expect(bodyFor('Password reset').value).toBe(
      PASSWORD_RESET_EMAIL.defaultHtml
    )
    expect(
      within(card('Password reset')).getByText(/using the shipped default/i)
    ).toBeTruthy()
  })

  it('shows a stored override, marked as customized', async () => {
    stubApi()
    renderEmail(seedWith({ 'password-reset': { subject: 'Stored subject' } }))
    await waitFor(() =>
      expect(subjectFor('Password reset').value).toBe('Stored subject')
    )
    expect(within(card('Password reset')).getByText(/customized/i)).toBeTruthy()
  })
})

describe('EmailSettings — token palette', () => {
  it('lists every token of the type with its description', async () => {
    stubApi()
    renderEmail()
    const region = await screen.findByRole('region', { name: 'Password reset' })
    for (const t of PASSWORD_RESET_EMAIL.tokens) {
      const btn = within(region).getByRole('button', {
        name: new RegExp(`insert .*${t.name}`, 'i')
      })
      expect(btn.textContent).toContain(t.description)
    }
  })

  // The DoD line: insert AT THE CURSOR, not appended blindly.
  it('inserts the token at the cursor of the focused field', async () => {
    stubApi()
    renderEmail()
    const body = await waitFor(() => bodyFor('Password reset'))
    fireEvent.change(body, { target: { value: 'AB' } })
    body.focus()
    body.setSelectionRange(1, 1)
    fireEvent.select(body)

    fireEvent.click(
      within(card('Password reset')).getByRole('button', {
        name: /insert .*user_name/i
      })
    )
    await waitFor(() =>
      expect(bodyFor('Password reset').value).toBe('A{{user_name}}B')
    )
    // Caret lands after the inserted token so typing continues naturally.
    expect(bodyFor('Password reset').selectionStart).toBe(
      'A{{user_name}}'.length
    )
  })

  it('replaces the current selection rather than duplicating it', async () => {
    stubApi()
    renderEmail()
    const body = await waitFor(() => bodyFor('Password reset'))
    fireEvent.change(body, { target: { value: 'AXB' } })
    body.focus()
    body.setSelectionRange(1, 2)
    fireEvent.select(body)
    fireEvent.click(
      within(card('Password reset')).getByRole('button', {
        name: /insert .*user_name/i
      })
    )
    await waitFor(() =>
      expect(bodyFor('Password reset').value).toBe('A{{user_name}}B')
    )
  })

  it('inserts into the SUBJECT when the subject is the focused field', async () => {
    stubApi()
    renderEmail()
    const subject = await waitFor(() => subjectFor('Password reset'))
    fireEvent.change(subject, { target: { value: 'Hi ' } })
    subject.focus()
    subject.setSelectionRange(3, 3)
    fireEvent.select(subject)
    fireEvent.click(
      within(card('Password reset')).getByRole('button', {
        name: /insert .*site_title/i
      })
    )
    await waitFor(() =>
      expect(subjectFor('Password reset').value).toBe('Hi {{site_title}}')
    )
  })

  it('defaults to the end of the body when nothing in the card has focus', async () => {
    stubApi()
    renderEmail()
    const body = await waitFor(() => bodyFor('Password reset'))
    fireEvent.change(body, { target: { value: 'AB' } })
    fireEvent.blur(body)
    fireEvent.click(
      within(card('Password reset')).getByRole('button', {
        name: /insert .*user_name/i
      })
    )
    await waitFor(() =>
      expect(bodyFor('Password reset').value).toBe('AB{{user_name}}')
    )
  })

  it('warns about a token the type does not define', async () => {
    stubApi()
    renderEmail()
    const body = await waitFor(() => bodyFor('Password reset'))
    fireEvent.change(body, { target: { value: '<p>{{nope}}</p>' } })
    const warning = await within(card('Password reset')).findByRole('alert')
    expect(warning.textContent).toContain('{{nope}}')
    expect(warning.textContent).toMatch(/render as nothing/i)
  })
})

describe('EmailSettings — live preview', () => {
  // The reason this whole epic exists: the preview must BE core's output, not a UI-side
  // reimplementation that can drift from what the server sends.
  it('renders the preview with core’s renderEmailTemplate over the type’s sampleValues', async () => {
    stubApi()
    renderEmail()
    await waitFor(() => bodyFor('Password reset'))
    const expected = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      {},
      PASSWORD_RESET_EMAIL.sampleValues
    )
    expect(previewFrame('Password reset').getAttribute('srcdoc')).toBe(
      expected.html
    )
    expect(
      within(card('Password reset')).getByText(expected.subject, {
        selector: '*'
      })
    ).toBeTruthy()
  })

  it('re-renders the preview as the body is edited, still through core', async () => {
    stubApi()
    renderEmail()
    const body = await waitFor(() => bodyFor('Password reset'))
    fireEvent.change(body, {
      target: {
        value: '<p>Hi {{user_name}} — <a href="{{reset_url}}">go</a></p>'
      }
    })
    const expected = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { html: '<p>Hi {{user_name}} — <a href="{{reset_url}}">go</a></p>' },
      PASSWORD_RESET_EMAIL.sampleValues
    )
    await waitFor(() =>
      expect(previewFrame('Password reset').getAttribute('srcdoc')).toBe(
        expected.html
      )
    )
    // The escaping the server applies is visible in the preview too — nothing is re-escaped
    // or un-escaped on the way to the frame.
    expect(expected.html).toContain('href="https://api.example.com')
  })

  it('shows the derived plain-text part, byte-identical to core’s', async () => {
    stubApi()
    renderEmail()
    await waitFor(() => bodyFor('Password reset'))
    const expected = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      {},
      PASSWORD_RESET_EMAIL.sampleValues
    )
    expect(
      within(card('Password reset')).getByText(expected.text, {
        collapseWhitespace: false
      })
    ).toBeTruthy()
  })

  // Admin-authored HTML must not execute in the admin origin: the frame is sandboxed with no
  // allow-scripts. Kill-shot: drop the sandbox attribute and this fails.
  it('renders the preview in a script-less sandboxed frame', async () => {
    stubApi()
    renderEmail()
    await waitFor(() => bodyFor('Password reset'))
    const frame = previewFrame('Password reset')
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('src')).toBeNull()
  })
})

describe('EmailSettings — validation, reset and save', () => {
  it('blocks saving an oversized body and says why', async () => {
    stubApi()
    renderEmail(seedWith({}))
    const body = await waitFor(() => bodyFor('Password reset'))
    fireEvent.change(body, {
      target: { value: 'x'.repeat(EMAIL_TEMPLATE_MAX_BODY + 1) }
    })
    expect(
      await within(card('Password reset')).findByText(/too long/i)
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })

  it('reset-to-default clears the stored override', async () => {
    stubApi()
    const { git } = renderEmail(
      seedWith({
        'password-reset': { subject: 'Stored', html: '<p>Stored</p>' }
      })
    )
    await waitFor(() =>
      expect(subjectFor('Password reset').value).toBe('Stored')
    )
    fireEvent.click(
      within(card('Password reset')).getByRole('button', {
        name: /reset to default/i
      })
    )
    await waitFor(() =>
      expect(subjectFor('Password reset').value).toBe(
        PASSWORD_RESET_EMAIL.defaultSubject
      )
    )
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      const email = (JSON.parse(raw as string) as Record<string, unknown>)
        .email as { templates: Record<string, unknown> }
      expect(email.templates['password-reset']).toBeUndefined()
    })
  })

  it('reset-to-default is disabled for a type that has no override', async () => {
    stubApi()
    renderEmail()
    await waitFor(() => bodyFor('Password reset'))
    expect(
      within(card('Password reset')).getByRole('button', {
        name: /reset to default/i
      })
    ).toBeDisabled()
  })

  // Only the fields the admin actually changed are stored — a template left at its default is
  // absent from settings.json, so a future default improvement still reaches that site.
  it('saves only the fields that differ from the shipped default', async () => {
    stubApi()
    const { git } = renderEmail(seedWith({}))
    const subject = await waitFor(() => subjectFor('Password reset'))
    fireEvent.change(subject, { target: { value: 'My reset subject' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      const email = (JSON.parse(raw as string) as Record<string, unknown>)
        .email as {
        templates: Record<string, { subject?: string; html?: string }>
      }
      expect(email.templates['password-reset']).toEqual({
        subject: 'My reset subject'
      })
      expect(email.templates['form-notification']).toBeUndefined()
    })
  })

  it('a passthrough key inside the email group survives a template save', async () => {
    stubApi()
    const { git } = renderEmail({
      email: { fromAddress: 'a@b.co', futureThing: { x: 1 }, templates: {} }
    })
    const subject = await waitFor(() => subjectFor('Password reset'))
    fireEvent.change(subject, { target: { value: 'Changed' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      const email = (JSON.parse(raw as string) as Record<string, unknown>)
        .email as Record<string, unknown>
      expect(email.futureThing).toEqual({ x: 1 })
    })
  })

  it('editing a template arms the shared Save button', async () => {
    stubApi()
    renderEmail(seedWith({}))
    const body = await waitFor(() => bodyFor('Password reset'))
    expect(screen.getByRole('button', { name: /saved/i })).toBeDisabled()
    fireEvent.change(body, { target: { value: '<p>Mine</p>' } })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /save changes/i })
      ).toBeEnabled()
    )
  })
})

describe('EmailSettings — maintainer read-only', () => {
  // Settings is visible to settings.view (maintainer+) but only editable by settings.manage
  // (admin); Settings.tsx enforces that with a disabled <fieldset>, which natively disables
  // every nested control — including the new template fields, palette and reset buttons.
  // NOTE the assertion is jest-dom's toBeDisabled(), not `.disabled`: the DOM property
  // reflects an element's OWN attribute, so a control inside a disabled <fieldset> reads
  // `.disabled === false` while being genuinely non-interactive. toBeDisabled() implements the
  // spec's "actually disabled", which is the property that matters here.
  it('every template control is disabled inside the read-only fieldset', async () => {
    stubApi()
    renderEmail(seedWith({}), { readOnly: true })
    await waitFor(() => expect(bodyFor('Password reset')).toBeDisabled())
    expect(subjectFor('Password reset')).toBeDisabled()
    const region = card('Password reset')
    for (const btn of within(region).getAllByRole('button'))
      expect(btn).toBeDisabled()
    // …and the preview still renders, because read-only means read.
    expect(previewFrame('Password reset').getAttribute('srcdoc')).toBeTruthy()
  })
})
