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
import { nearMissBracesIn } from '../src/screens/settings/EmailTemplates'

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

  // A never-focused field has `selectionStart === 0`, NOT null, so "no caret yet" is
  // indistinguishable from "caret at the start" unless focus is tracked explicitly. Nothing is
  // typed or focused before the click here on purpose: the previous version of this test fired a
  // change event first, which moves the caret to the end and made it pass over a fallback arm
  // that was dead code — a test that vouched for a bug (§4 #21).
  it('appends at the end of a body that has never been focused', async () => {
    stubApi()
    renderEmail()
    await waitFor(() => bodyFor('Password reset'))
    fireEvent.click(
      within(card('Password reset')).getByRole('button', {
        name: /insert .*user_name/i
      })
    )
    await waitFor(() =>
      expect(bodyFor('Password reset').value).toBe(
        `${PASSWORD_RESET_EMAIL.defaultHtml}{{user_name}}`
      )
    )
  })

  it('appends at the end of a never-focused SUBJECT-less card too, without touching the subject', async () => {
    stubApi()
    renderEmail()
    await waitFor(() => bodyFor('Password reset'))
    fireEvent.click(
      within(card('Password reset')).getByRole('button', {
        name: /insert .*site_title/i
      })
    )
    await waitFor(() =>
      expect(bodyFor('Password reset').value).toBe(
        `${PASSWORD_RESET_EMAIL.defaultHtml}{{site_title}}`
      )
    )
    expect(subjectFor('Password reset').value).toBe(
      PASSWORD_RESET_EMAIL.defaultSubject
    )
  })

  // The other half of the same rule: once a field HAS held the caret, that caret is honored
  // rather than the insertion being appended to the end, which would throw away where the admin
  // was working.
  //
  // Named for what it proves HERE and no more (#940). `fireEvent.blur` dispatches a blur event
  // without moving `document.activeElement` — jsdom has no real focus — so the field is still
  // the active element when the click lands, and this exercises the SAME `targetField` arm as
  // the focused tests above. The genuinely-blurred case (focus really moved to the chip) needs a
  // real browser and lives in apps/admin/test-browser/email-token-palette.test.tsx.
  it('honors the caret of a field that has held focus', async () => {
    stubApi()
    renderEmail()
    const body = await waitFor(() => bodyFor('Password reset'))
    fireEvent.change(body, { target: { value: 'AB' } })
    body.focus()
    body.setSelectionRange(1, 1)
    fireEvent.select(body)
    fireEvent.blur(body)
    fireEvent.click(
      within(card('Password reset')).getByRole('button', {
        name: /insert .*user_name/i
      })
    )
    await waitFor(() =>
      expect(bodyFor('Password reset').value).toBe('A{{user_name}}B')
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

  // The help text under the body must describe what ACTUALLY happens. With no HTML override the
  // sent text part is the type's hand-written `defaultText` (materially different wording for
  // password reset); only an overridden HTML body makes the text part derived from it.
  it('says the plain-text part is the shipped one until the HTML is overridden', async () => {
    stubApi()
    renderEmail()
    const body = await waitFor(() => bodyFor('Password reset'))
    const region = card('Password reset')
    expect(
      within(region).getByText(/plain-text version.*Setu ships/i)
    ).toBeTruthy()
    expect(within(region).queryByText(/generated from this HTML/i)).toBeNull()

    fireEvent.change(body, { target: { value: '<p>Mine {{reset_url}}</p>' } })
    await waitFor(() =>
      expect(
        within(card('Password reset')).getByText(/generated from this HTML/i)
      ).toBeTruthy()
    )
  })

  // #920 review F2. There is a THIRD arm: a body that is usable AND renders non-blank can still
  // DERIVE an empty text part (markup with no words in it), and the renderer then sends the
  // shipped text. The help text used to be computed from `isUsableTemplateField` alone, so it
  // claimed "generated from this HTML" while the preview panel two inches away showed the shipped
  // text — the two halves of one card disagreeing about the same email. Kill-shot: compute
  // textPartSource from the predicates instead of from what renderEmailTemplate returned.
  const IMAGE_ONLY_BODY = '<img src="{{reset_url}}" alt="">'

  it('says the plain-text part is the shipped one for a body that derives to nothing', async () => {
    stubApi()
    renderEmail()
    const body = await waitFor(() => bodyFor('Password reset'))
    fireEvent.change(body, { target: { value: IMAGE_ONLY_BODY } })

    const expected = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { html: IMAGE_ONLY_BODY },
      PASSWORD_RESET_EMAIL.sampleValues
    )
    // Guard the guard: this case only bites while the body renders non-blank (so the authoring
    // block lets it through) and its derivation is empty (so the shipped text wins).
    expect(expected.html).not.toBe('')
    expect(expected.textSource).toBe('shipped')

    await waitFor(() =>
      expect(
        within(card('Password reset')).getByText(/Setu ships/i)
      ).toBeTruthy()
    )
    const region = card('Password reset')
    // The claim that was false: the body IS overridden, but nothing is generated from it.
    expect(within(region).queryByText(/generated from this HTML/i)).toBeNull()
    // …and the panel below agrees, byte for byte.
    expect(
      within(region).getByText(expected.text, { collapseWhitespace: false })
    ).toBeTruthy()
    // A legitimate save: an image-only body renders something, so it is not blocked.
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
  })

  // …and it says WHY, correctly. The generic shipped-arm wording ("it only follows this HTML once
  // you change the HTML") is false here, because the admin just did change it. Kill-shot: drop the
  // htmlSource branch and this fails on the "no text to extract" phrasing.
  it('explains that a wordless body has no text to extract', async () => {
    stubApi()
    renderEmail()
    const body = await waitFor(() => bodyFor('Password reset'))
    fireEvent.change(body, { target: { value: IMAGE_ONLY_BODY } })
    const region = () => card('Password reset')
    await waitFor(() =>
      expect(within(region()).getByText(/no text to extract/i)).toBeTruthy()
    )
    expect(within(region()).queryByText(/once you change the HTML/i)).toBeNull()

    // The generic wording is still right when the body is genuinely untouched.
    fireEvent.change(body, {
      target: { value: PASSWORD_RESET_EMAIL.defaultHtml }
    })
    await waitFor(() =>
      expect(
        within(region()).getByText(/once you change the HTML/i)
      ).toBeTruthy()
    )
  })

  // #922: this was named "shows the derived plain-text part" while rendering with an EMPTY
  // override — i.e. it exercised the SHIPPED-text arm, and the derived one (the whole reason
  // htmlToPlainText exists) went unasserted. Renamed to what it proves; the derived arm gets its
  // own test below.
  it('shows the shipped plain-text part, byte-identical to core’s', async () => {
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

  // The plain-text HALF of preview parity: once the HTML is overridden the text part is derived
  // from it, and what the admin reads under the preview must be those exact bytes — a text-only
  // recipient sees this, and nothing else shows it to the admin. Kill-shot: derive the panel's
  // text in the UI instead of reading core's `preview.text` and this fails.
  const OVERRIDE_HTML =
    '<p>Hi {{user_name}}</p><p><a href="{{reset_url}}">Reset it</a></p>'

  it('shows the DERIVED plain-text part once the HTML is overridden, byte-identical to core’s', async () => {
    stubApi()
    renderEmail()
    const body = await waitFor(() => bodyFor('Password reset'))
    fireEvent.change(body, { target: { value: OVERRIDE_HTML } })
    const expected = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { html: OVERRIDE_HTML },
      PASSWORD_RESET_EMAIL.sampleValues
    )
    // Guard the guard: if this ever equalled the shipped text the assertion below would pass
    // without the derived arm ever running — exactly the hole #922 found.
    const shipped = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      {},
      PASSWORD_RESET_EMAIL.sampleValues
    ).text
    expect(expected.text).not.toBe(shipped)
    expect(expected.text).toBe(
      'Hi Ada Lovelace\n\nReset it (https://api.example.com/api/auth/reset-password/EXAMPLE-TOKEN?callbackURL=%2Freset-password)'
    )
    await waitFor(() =>
      expect(
        within(card('Password reset')).getByText(expected.text, {
          collapseWhitespace: false
        })
      ).toBeTruthy()
    )
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

  // #920. The authoring-time half of the render-time floor: a template can be non-empty, in-cap
  // and still produce NOTHING, because unknown tokens strip to empty and the grammar is
  // case-sensitive. The admin must find out here rather than by a user receiving a blank-subject
  // email. Kill-shot: drop the renderTemplateField check in validateEmailTemplates and the Save
  // button stays enabled.
  it('blocks saving a subject that renders to nothing and says why', async () => {
    stubApi()
    renderEmail(seedWith({}))
    const subject = await waitFor(() => subjectFor('Password reset'))
    fireEvent.change(subject, { target: { value: '{{Reset_Url}}' } })
    expect(
      await within(card('Password reset')).findByText(/renders to nothing/i)
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })

  it('blocks saving a body that renders to nothing and says why', async () => {
    stubApi()
    renderEmail(seedWith({}))
    const body = await waitFor(() => bodyFor('Password reset'))
    fireEvent.change(body, { target: { value: '{{nope}}' } })
    expect(
      await within(card('Password reset')).findByText(/renders to nothing/i)
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })

  // The control: a template that still renders SOMETHING is not blocked, even when part of it
  // is an unknown token (that stays a warning, not an error).
  it('allows saving a subject that still renders something', async () => {
    stubApi()
    renderEmail(seedWith({}))
    const subject = await waitFor(() => subjectFor('Password reset'))
    fireEvent.change(subject, { target: { value: 'Reset · {{nope}}' } })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /save changes/i })
      ).toBeEnabled()
    )
    expect(
      within(card('Password reset')).queryByText(/renders to nothing/i)
    ).toBeNull()
  })

  /**
   * #924. `{{reset-url}}` is not a token at all: the grammar is `\{\{\s*(\w+)\s*\}\}` and a hyphen
   * is not `\w`, so the span never matches. It is therefore not substituted (the recipient sees the
   * literal braces), not caught by the unknown-token warning (`unknownTokensIn` collects names
   * through the same regex, so it finds nothing) and not caught by #920's renders-to-nothing check
   * (the output is non-empty — it is the braces).
   *
   * The render behavior is deliberate and already recorded where it is decided, next to `TOKEN_RE`
   * in packages/core/src/templating/fill-template.ts, pinned by
   * packages/core/test/templating/fill-template.test.ts ("leaves non-token braces alone"): visible
   * beats silent. What was missing was any warning at authoring time.
   *
   * Kill-shot: delete the `nearMiss` block in EmailTemplates.tsx and both of these fail.
   */
  it('warns about a hyphenated near-miss token, naming the offending text', async () => {
    stubApi()
    renderEmail(seedWith({}))
    const subject = await waitFor(() => subjectFor('Password reset'))
    fireEvent.change(subject, { target: { value: 'Reset {{reset-url}}' } })
    const scope = within(card('Password reset'))
    const alert = await scope.findByText(/not a token/i)
    expect(alert.textContent).toContain('{{reset-url}}')
    // Sent exactly as written — the honest consequence, and the one the admin needs to hear.
    expect(alert.textContent).toMatch(/exactly as written/i)
    // And that IS what happens: the preview, produced by the same core function the api sends
    // with, shows the literal braces in the subject line rather than an empty one.
    expect(scope.getByText('Reset {{reset-url}}')).toBeTruthy()
  })

  it('warns about empty braces and about a multi-word span', async () => {
    stubApi()
    renderEmail(seedWith({}))
    const body = await waitFor(() => bodyFor('Password reset'))
    fireEvent.change(body, {
      target: { value: '<p>{{}} and {{reset url}} and {{reset_url}}</p>' }
    })
    const alert = await within(card('Password reset')).findByText(/not tokens/i)
    expect(alert.textContent).toContain('{{}}')
    expect(alert.textContent).toContain('{{reset url}}')
    // A REAL token is not named — this warning is about spans the grammar never matched, and
    // saying otherwise would send the admin looking for a bug in a line that works.
    expect(alert.textContent).not.toContain('{{reset_url}}')
  })

  // The two warnings answer different questions and must not collapse into each other: a
  // grammatically valid name the vocabulary does not define is an UNKNOWN token (it strips to
  // nothing), while a span the grammar never matched is a NEAR MISS (it survives literally).
  it('does not call a grammatically valid unknown token a near miss', async () => {
    stubApi()
    renderEmail(seedWith({}))
    const subject = await waitFor(() => subjectFor('Password reset'))
    fireEvent.change(subject, { target: { value: 'Reset {{Reset_Url}} now' } })
    const scope = within(card('Password reset'))
    expect(await scope.findByText(/unknown token/i)).toBeTruthy()
    expect(scope.queryByText(/not a token|not tokens/i)).toBeNull()
  })

  // #978 review F8. The stated boundary of the detector, pinned rather than assumed: the candidate
  // pattern excludes nested braces, so a span containing another span is not a candidate — the
  // OUTER braces go unreported (the docblock used to claim the inner span was reported instead).
  //
  // Asserted on the helper with EXACT strings, not only through the UI. The UI-level "no alert"
  // assertion below is true but weak: widening the candidate pattern to `[^}]*` leaves it green,
  // because the wider span still contains a valid token and so is still not a near miss. The
  // second case here is the one that bites — under `[^}]*` the reported string becomes
  // `{{ {{a-b}}` instead of `{{a-b}}`.
  it('brackets the nesting gap exactly (helper level)', () => {
    // Documented gap: outer span is not a candidate, inner span is a valid token → nothing.
    expect(nearMissBracesIn('Reset {{ {{reset_url}} }}')).toEqual([])
    // Inner span is itself a near miss → reported, and reported as the INNER span.
    expect(nearMissBracesIn('Reset {{ {{a-b}} }}')).toEqual(['{{a-b}}'])
  })

  it('reports nothing for a span that contains another span', async () => {
    stubApi()
    renderEmail(seedWith({}))
    const subject = await waitFor(() => subjectFor('Password reset'))
    fireEvent.change(subject, {
      target: { value: 'Reset {{ {{reset_url}} }}' }
    })
    const scope = within(card('Password reset'))
    await waitFor(() =>
      expect(subjectFor('Password reset').value).toBe(
        'Reset {{ {{reset_url}} }}'
      )
    )
    expect(scope.queryByText(/not a token|not tokens/i)).toBeNull()
    expect(scope.queryByText(/unknown token/i)).toBeNull()
  })

  it('is not a save blocker — a near miss is visibly wrong, not silently broken', async () => {
    stubApi()
    renderEmail(seedWith({}))
    const subject = await waitFor(() => subjectFor('Password reset'))
    fireEvent.change(subject, { target: { value: 'Reset {{reset-url}}' } })
    await within(card('Password reset')).findByText(/not a token/i)
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
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
