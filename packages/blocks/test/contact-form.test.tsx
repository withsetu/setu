// packages/blocks/test/contact-form.test.tsx
//
// The published contact island (#1248, #971): unavailable state, accessible validation,
// honeypot wiring, captcha failure/retry, and author-supplied text.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import type { CaptchaFailure } from '../src/contact/mount-captcha'

interface MountOpts {
  onToken: (t: string) => void
  onReady?: () => void
  onError?: (r: CaptchaFailure) => void
}
const mounts: MountOpts[] = []
vi.mock('../src/contact/mount-captcha', () => ({
  mountCaptcha: (o: MountOpts) => {
    mounts.push(o)
    return { reset: vi.fn(), cleanup: vi.fn() }
  }
}))

const { default: ContactForm, HONEYPOT_FIELD } =
  await import('../src/contact/ContactForm')

const fetchMock = vi.fn()
beforeEach(() => {
  mounts.length = 0
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const base = {
  formId: 'f1',
  apiBase: 'https://api.example.test',
  provider: 'turnstile' as const,
  siteKey: '',
  required: { name: true, subject: false, message: true },
  successMessage: 'Thanks!'
}

const fill = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
const send = () =>
  fireEvent.submit(
    screen.getByRole('button', { name: /send/i }).closest('form')!
  )
const sentBody = () =>
  JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as {
    honeypot?: string
    fields: Record<string, string>
  }

describe('unavailable (no API endpoint in a production build, #1248)', () => {
  it('says so, disables Send, and never loads a captcha or posts', () => {
    render(<ContactForm {...base} apiBase={null} siteKey="k" />)
    expect(
      screen.getByText("This form isn't available right now.")
    ).toBeInTheDocument()
    const button = screen.getByRole('button', { name: /send/i })
    expect(button).toBeDisabled()
    send()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mounts).toHaveLength(0)
  })
})

describe('accessible validation (#1248)', () => {
  it('marks required fields with aria-required and a visible marker', () => {
    render(
      <ContactForm
        {...base}
        required={{ name: false, subject: false, message: true }}
      />
    )
    expect(screen.getByLabelText(/^name/i)).not.toHaveAttribute('aria-required')
    expect(screen.getByLabelText(/^email/i)).toHaveAttribute(
      'aria-required',
      'true'
    )
    expect(screen.getByLabelText(/^message/i)).toHaveAttribute(
      'aria-required',
      'true'
    )
    const markers = document.querySelectorAll('.setu-contact__req')
    expect(markers).toHaveLength(2)
    markers.forEach((m) => expect(m).toHaveAttribute('aria-hidden', 'true'))
  })

  it('links each invalid field to its error, focuses the first, and uses one polite region', () => {
    render(<ContactForm {...base} />)
    send()
    const name = screen.getByLabelText(/^name/i)
    const email = screen.getByLabelText(/^email/i)
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Required.')
    expect(email).toHaveAccessibleDescription('Enter a valid email address.')
    expect(document.activeElement).toBe(name)
    // no per-field alerts firing at once — a single persistent status region instead
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    const regions = screen.getAllByRole('status')
    expect(regions).toHaveLength(1)
    expect(regions[0]).toHaveAttribute('aria-live', 'polite')
    expect(regions[0]).toHaveTextContent(/correct the highlighted fields/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('focuses the first invalid field in form order, not the first error key', () => {
    render(<ContactForm {...base} />)
    fill(/^name/i, 'Ada')
    send()
    expect(document.activeElement).toBe(screen.getByLabelText(/^email/i))
    expect(screen.getByLabelText(/^name/i)).not.toHaveAttribute('aria-invalid')
  })

  it('on success moves focus to the success message instead of dropping it to body', async () => {
    render(<ContactForm {...base} />)
    fill(/^name/i, 'Ada')
    fill(/^email/i, 'ada@example.com')
    fill(/^message/i, 'Hello')
    send()
    const done = await screen.findByText('Thanks!')
    expect(done).toHaveAttribute('tabindex', '-1')
    await waitFor(() => expect(document.activeElement).toBe(done))
  })
})

describe('honeypot (#1248)', () => {
  it('is a non-semantic trap field that autofill and password managers skip', () => {
    render(<ContactForm {...base} />)
    const trap = document.querySelector<HTMLInputElement>(
      `input[name="${HONEYPOT_FIELD}"]`
    )!
    expect(trap).toBeTruthy()
    expect(HONEYPOT_FIELD).not.toMatch(
      /company|name|mail|phone|address|url|web|org|title|city/i
    )
    expect(trap.closest('label')!.textContent).not.toMatch(/company/i)
    expect(trap.getAttribute('autocomplete')).not.toMatch(/^(on|off|)$/)
    expect(trap).toHaveAttribute('tabindex', '-1')
    expect(trap).toHaveAttribute('data-1p-ignore')
    expect(trap).toHaveAttribute('data-lpignore', 'true')
    expect(trap).toHaveAttribute('data-bwignore')
    expect(trap).toHaveAttribute('data-form-type', 'other')
    expect(trap.closest('[aria-hidden="true"]')).toBeTruthy()
  })

  it('sends the trap field value as the wire `honeypot` the server drops on', async () => {
    render(<ContactForm {...base} />)
    fill(/^name/i, 'Bot')
    fill(/^email/i, 'bot@example.com')
    fill(/^message/i, 'spam')
    fireEvent.change(
      document.querySelector(`input[name="${HONEYPOT_FIELD}"]`)!,
      { target: { value: 'gotcha' } }
    )
    send()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(sentBody().honeypot).toBe('gotcha')
  })

  it('sends an empty honeypot for a human', async () => {
    render(<ContactForm {...base} />)
    fill(/^name/i, 'Ada')
    fill(/^email/i, 'ada@example.com')
    fill(/^message/i, 'Hello')
    send()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(sentBody().honeypot).toBe('')
  })
})

describe('captcha load failure (#971)', () => {
  const fillValid = () => {
    fill(/^name/i, 'Ada')
    fill(/^email/i, 'ada@example.com')
    fill(/^message/i, 'Hello')
  }

  it('shows a loading hint until the widget is ready', () => {
    render(<ContactForm {...base} siteKey="k" />)
    expect(screen.getByText(/loading the spam check/i)).toBeInTheDocument()
    act(() => mounts[0]!.onReady?.())
    expect(screen.queryByText(/loading the spam check/i)).toBeNull()
  })

  it('says the spam check could not load, disables Send, and offers a Retry that remounts', () => {
    render(<ContactForm {...base} siteKey="k" />)
    expect(mounts).toHaveLength(1)
    act(() => mounts[0]!.onError?.('load'))
    expect(screen.getByRole('status')).toHaveTextContent(
      "The spam check couldn't load. Check your connection or try again later."
    )
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
    expect(screen.queryByText(/loading the spam check/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(mounts).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
    expect(screen.getByText(/loading the spam check/i)).toBeInTheDocument()
    act(() => {
      mounts[1]!.onReady?.()
      mounts[1]!.onToken('tok')
    })
    expect(screen.getByRole('button', { name: /send/i })).toBeEnabled()
  })

  it('a timeout reads the same as a load error', () => {
    render(<ContactForm {...base} siteKey="k" />)
    act(() => mounts[0]!.onError?.('timeout'))
    expect(screen.getByRole('status')).toHaveTextContent(/couldn't load/i)
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('an unsolved challenge asks for it — not the generic error', () => {
    render(<ContactForm {...base} siteKey="k" />)
    act(() => mounts[0]!.onReady?.())
    fillValid()
    send()
    expect(screen.getByRole('status')).toHaveTextContent(
      /complete the spam check/i
    )
    expect(screen.queryByText(/something went wrong/i)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a still-loading challenge says so', () => {
    render(<ContactForm {...base} siteKey="k" />)
    fillValid()
    send()
    expect(screen.getByRole('status')).toHaveTextContent(/still loading/i)
  })

  it('no captcha configured: no hint, no retry, sends', async () => {
    render(<ContactForm {...base} />)
    expect(mounts).toHaveLength(0)
    expect(screen.queryByText(/spam check/i)).toBeNull()
    fillValid()
    send()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })
})

describe('author-supplied text (#1248)', () => {
  it('renders the labels, button text and error message it is given', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'server' }), {
        status: 500
      })
    )
    render(
      <ContactForm
        {...base}
        subject
        labels={{
          name: 'Nom',
          email: 'Courriel',
          subject: 'Objet',
          message: 'Votre message'
        }}
        submitLabel="Envoyer"
        errorMessage="Une erreur est survenue."
      />
    )
    expect(screen.getByLabelText(/^Nom/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Courriel/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Objet/)).toBeInTheDocument()
    fill(/^Nom/, 'Ada')
    fill(/^Courriel/, 'ada@example.com')
    fill(/^Votre message/, 'Bonjour')
    fireEvent.submit(
      screen.getByRole('button', { name: 'Envoyer' }).closest('form')!
    )
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Une erreur est survenue.'
      )
    )
  })
})
