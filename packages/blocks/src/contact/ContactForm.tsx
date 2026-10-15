// packages/blocks/src/contact/ContactForm.tsx
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  CONTACT_DEFAULT_TEXT,
  validateContactFields,
  submitContact,
  type ContactRequired
} from '@setu/core'
import { mountCaptcha, type CaptchaProvider } from './mount-captcha'
import './contact.css'

// FormData.get() returns `FormDataEntryValue | null` (string | File | null) — every
// field here is a text/email/textarea/hidden input, never a file input, but the type
// doesn't know that. A plain `String(fd.get(...))` would silently stringify a File to
// "[object File]" if that assumption is ever wrong (@typescript-eslint/no-base-to-string
// catches exactly this class of bug); this keeps the runtime behavior identical for the
// expected case and fails safe (empty string) for the unexpected one instead of garbage.
const fieldValue = (fd: FormData, name: string): string => {
  const v = fd.get(name)
  return typeof v === 'string' ? v : ''
}

/** The bot-trap input's name (#1248). Deliberately non-semantic: browser autofill and
 *  password managers match on name/label/autocomplete heuristics, so a trap called
 *  "company" got filled for real visitors, whose messages were then silently dropped.
 *  Only this island reads it; the wire key the server checks stays `honeypot`, so pages
 *  cached with the old field name keep working. Enforced by
 *  packages/blocks/test/contact-form.test.tsx ("honeypot"). */
export const HONEYPOT_FIELD = 'setu_hp_k7'

type FieldName = 'name' | 'email' | 'subject' | 'message'
const FIELD_ORDER: FieldName[] = ['name', 'email', 'subject', 'message']

const DEFAULT_LABELS: Record<FieldName, string> = {
  name: CONTACT_DEFAULT_TEXT.nameLabel,
  email: CONTACT_DEFAULT_TEXT.emailLabel,
  subject: CONTACT_DEFAULT_TEXT.subjectLabel,
  message: CONTACT_DEFAULT_TEXT.messageLabel
}

const UNAVAILABLE = "This form isn't available right now."
const CAPTCHA_FAILED =
  "The spam check couldn't load. Check your connection or try again later."
const CAPTCHA_LOADING =
  'The spam check is still loading. Try again in a moment.'
const CAPTCHA_NEEDED = 'Complete the spam check, then send.'
const INVALID = 'Please correct the highlighted fields.'

export interface ContactFormProps {
  formId: string
  formLabel?: string
  /** The forms API origin. `null` = no endpoint is configured for this build (a production
   *  build without PUBLIC_SETU_API_BASE): the form renders as unavailable instead of posting
   *  somewhere that cannot receive it. */
  apiBase: string | null
  /** Captcha provider ('turnstile' | 'recaptcha'). */
  provider: CaptchaProvider
  /** The provider's public site key (rendered into the widget). */
  siteKey: string
  subject?: boolean
  required: ContactRequired
  /** Per-field label overrides; unset fields use CONTACT_DEFAULT_TEXT. */
  labels?: Partial<Record<FieldName, string>>
  placeholders?: Partial<Record<FieldName, string>>
  submitLabel?: string
  errorMessage?: string
  successMessage: string
}

type FormStatus =
  | 'idle'
  | 'invalid'
  | 'captcha-loading'
  | 'captcha-needed'
  | 'sending'
  | 'done'
  | 'error'

/** none = no provider configured; loading = script/widget not rendered yet; failed = it
 *  never will without a retry (#971). */
type CaptchaState = 'none' | 'loading' | 'ready' | 'failed'

export default function ContactForm(props: ContactFormProps) {
  const {
    formId,
    formLabel,
    apiBase,
    provider,
    siteKey,
    subject = false,
    required,
    labels = {},
    placeholders = {},
    successMessage
  } = props
  const submitLabel = props.submitLabel || CONTACT_DEFAULT_TEXT.submitLabel
  const errorMessage = props.errorMessage || CONTACT_DEFAULT_TEXT.errorMessage
  const unavailable = apiBase === null
  const captchaWanted = Boolean(siteKey) && !unavailable

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<FormStatus>('idle')
  const [token, setToken] = useState('')
  const [captcha, setCaptcha] = useState<CaptchaState>(
    captchaWanted ? 'loading' : 'none'
  )
  const [attempt, setAttempt] = useState(0)
  const widgetRef = useRef<HTMLDivElement>(null)
  const successRef = useRef<HTMLParagraphElement>(null)
  const fieldRefs = useRef<
    Partial<Record<FieldName, HTMLInputElement | HTMLTextAreaElement | null>>
  >({})
  const captchaRef = useRef<{ reset: () => void; cleanup: () => void } | null>(
    null
  )

  useEffect(() => {
    if (!captchaWanted || !widgetRef.current) return
    const handle = mountCaptcha({
      provider,
      siteKey,
      el: widgetRef.current,
      onToken: setToken,
      onReady: () => setCaptcha('ready'),
      onError: () => setCaptcha('failed')
    })
    captchaRef.current = handle
    return () => {
      handle.cleanup()
      captchaRef.current = null
    }
  }, [provider, siteKey, captchaWanted, attempt])

  // The form (and its focused button) unmounts on success; hand focus to the message so a
  // keyboard / screen-reader user is not dropped to <body>.
  useEffect(() => {
    if (status === 'done') successRef.current?.focus()
  }, [status])

  function retryCaptcha() {
    setToken('')
    setCaptcha('loading')
    if (status === 'captcha-loading' || status === 'captcha-needed')
      setStatus('idle')
    setAttempt((a) => a + 1)
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (unavailable || captcha === 'failed' || status === 'sending') return
    const form = e.currentTarget
    const fd = new FormData(form)
    const fields: Record<string, string> = {
      name: fieldValue(fd, 'name'),
      email: fieldValue(fd, 'email'),
      message: fieldValue(fd, 'message')
    }
    if (subject) fields.subject = fieldValue(fd, 'subject')

    const v = validateContactFields(fields, required)
    setErrors(v.errors)
    if (!v.ok) {
      setStatus('invalid')
      const first = FIELD_ORDER.find((f) => v.errors[f])
      if (first) fieldRefs.current[first]?.focus()
      return
    }

    if (captcha !== 'none' && token === '') {
      // A provider is configured but the widget hasn't produced a token yet.
      setStatus(captcha === 'loading' ? 'captcha-loading' : 'captcha-needed')
      return
    }

    setStatus('sending')
    try {
      const result = await submitContact({
        apiBase,
        formId,
        formLabel,
        fields,
        captchaToken: token,
        honeypot: fieldValue(fd, HONEYPOT_FIELD),
        pageUrl:
          typeof window !== 'undefined' ? window.location.href : undefined
      })
      if (result.ok) {
        setStatus('done')
        return
      }
    } catch {
      // submitContact maps transport failures to a result; anything else still lands here
      // as the same visible error rather than a stuck "Sending…".
    }
    setStatus('error')
    captchaRef.current?.reset()
    setToken('')
  }

  if (status === 'done') {
    return (
      <p ref={successRef} className="setu-contact__success" tabIndex={-1}>
        {successMessage}
      </p>
    )
  }

  const message: { text: string; tone: 'error' | 'info' } | null = unavailable
    ? { text: UNAVAILABLE, tone: 'info' }
    : captcha === 'failed'
      ? { text: CAPTCHA_FAILED, tone: 'error' }
      : status === 'invalid'
        ? { text: INVALID, tone: 'error' }
        : status === 'captcha-loading'
          ? { text: CAPTCHA_LOADING, tone: 'error' }
          : status === 'captcha-needed'
            ? { text: CAPTCHA_NEEDED, tone: 'error' }
            : status === 'error'
              ? { text: errorMessage, tone: 'error' }
              : null

  const isRequired = (name: FieldName): boolean =>
    name === 'email' ? true : required[name]

  const field = (name: FieldName, type: 'text' | 'email' | 'textarea') => {
    const id = `setu-${formId}-${name}`
    const errorId = `${id}-error`
    const error = errors[name]
    const common = {
      id,
      name,
      placeholder: placeholders[name] ?? '',
      disabled: unavailable,
      'aria-required': isRequired(name) || undefined,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? errorId : undefined
    }
    return (
      <div className="setu-contact__row">
        <label htmlFor={id}>
          {labels[name] || DEFAULT_LABELS[name]}
          {isRequired(name) && (
            <span className="setu-contact__req" aria-hidden="true">
              {' *'}
            </span>
          )}
        </label>
        {type === 'textarea' ? (
          <textarea
            {...common}
            ref={(el) => {
              fieldRefs.current[name] = el
            }}
            rows={5}
          />
        ) : (
          <input
            {...common}
            ref={(el) => {
              fieldRefs.current[name] = el
            }}
            type={type}
          />
        )}
        {error && (
          <span id={errorId} className="setu-contact__error">
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <form
      className="setu-contact"
      onSubmit={(e) => void onSubmit(e)}
      noValidate
    >
      {field('name', 'text')}
      {field('email', 'email')}
      {subject && field('subject', 'text')}
      {field('message', 'textarea')}
      {/* Honeypot: off-screen, hidden from AT and the tab order, and opted out of browser
          autofill (unrecognised autocomplete token) and the password managers that ignore
          it (1Password, LastPass, Bitwarden, Dashlane, Proton Pass). Bots fill it. */}
      <div className="setu-contact__hp" aria-hidden="true">
        <label>
          Leave this field empty
          {/* autoComplete is deliberately NOT a valid token: "off" is ignored by autofill and
              any valid field token invites a fill; an unrecognised one leaves nothing to
              match (#1248). */}
          {/* eslint-disable-next-line jsx-a11y/autocomplete-valid -- intentional, see above */}
          <input
            name={HONEYPOT_FIELD}
            type="text"
            tabIndex={-1}
            autoComplete="setu-trap"
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            data-form-type="other"
            data-protonpass-ignore="true"
          />
        </label>
      </div>
      {/* captcha provider renders explicitly into this div once its script has loaded. */}
      {captchaWanted && (
        <div ref={widgetRef} className="setu-contact__captcha" />
      )}
      {captcha === 'loading' && (
        <p className="setu-contact__hint">Loading the spam check…</p>
      )}
      {/* One persistent polite region for form-level status; per-field errors are tied to
          their inputs via aria-describedby and announced when focus lands there. */}
      <p
        className={`setu-contact__status${message?.tone === 'error' ? ' is-error' : ''}`}
        role="status"
        aria-live="polite"
      >
        {message?.text ?? ''}
      </p>
      {captcha === 'failed' && (
        <button
          type="button"
          className="setu-contact__retry"
          onClick={retryCaptcha}
        >
          Retry spam check
        </button>
      )}
      <button
        type="submit"
        disabled={unavailable || captcha === 'failed' || status === 'sending'}
      >
        {status === 'sending' ? 'Sending…' : submitLabel}
      </button>
    </form>
  )
}
