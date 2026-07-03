// packages/blocks/src/contact/ContactForm.tsx
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { validateContactFields, submitContact, type ContactRequired } from '@setu/core'
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

export interface ContactFormProps {
  formId: string
  formLabel?: string
  apiBase: string
  /** Captcha provider ('turnstile' | 'recaptcha'). */
  provider: CaptchaProvider
  /** The provider's public site key (rendered into the widget). */
  siteKey: string
  subject?: boolean
  required: ContactRequired
  labels?: Record<string, string>
  placeholders?: Record<string, string>
  successMessage: string
}

export default function ContactForm(props: ContactFormProps) {
  const { formId, formLabel, apiBase, provider, siteKey, subject = false, required, labels = {}, placeholders = {}, successMessage } = props
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [token, setToken] = useState('')
  const widgetRef = useRef<HTMLDivElement>(null)
  const captchaRef = useRef<{ reset: () => void; cleanup: () => void } | null>(null)

  useEffect(() => {
    if (!siteKey || !widgetRef.current) return
    const handle = mountCaptcha({ provider, siteKey, el: widgetRef.current, onToken: setToken })
    captchaRef.current = handle
    return () => {
      handle.cleanup()
      captchaRef.current = null
    }
  }, [provider, siteKey])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const fields: Record<string, string> = {
      name: fieldValue(fd, 'name'),
      email: fieldValue(fd, 'email'),
      message: fieldValue(fd, 'message'),
    }
    if (subject) fields.subject = fieldValue(fd, 'subject')

    const v = validateContactFields(fields, required)
    setErrors(v.errors)
    if (!v.ok) return

    if (siteKey && token === '') {
      // A provider is configured but the widget hasn't produced a token yet.
      setStatus('error')
      return
    }

    setStatus('sending')
    const result = await submitContact({
      apiBase,
      formId,
      formLabel,
      fields,
      captchaToken: token,
      honeypot: fieldValue(fd, 'company'), // honeypot field
      pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    })
    if (result.ok) {
      setStatus('done')
      form.reset()
    } else {
      setStatus('error')
      captchaRef.current?.reset()
      setToken('')
    }
  }

  if (status === 'done') {
    return <p className="setu-contact__success" role="status">{successMessage}</p>
  }

  const field = (name: 'name' | 'email' | 'subject' | 'message', type: 'text' | 'email' | 'textarea') => (
    <div className="setu-contact__row">
      <label htmlFor={`setu-${formId}-${name}`}>{labels[name] ?? name[0]!.toUpperCase() + name.slice(1)}</label>
      {type === 'textarea' ? (
        <textarea id={`setu-${formId}-${name}`} name={name} placeholder={placeholders[name] ?? ''} rows={5} />
      ) : (
        <input id={`setu-${formId}-${name}`} name={name} type={type} placeholder={placeholders[name] ?? ''} />
      )}
      {errors[name] && <span className="setu-contact__error" role="alert">{errors[name]}</span>}
    </div>
  )

  return (
    <form className="setu-contact" onSubmit={onSubmit} noValidate>
      {field('name', 'text')}
      {field('email', 'email')}
      {subject && field('subject', 'text')}
      {field('message', 'textarea')}
      {/* Honeypot: visually hidden, bots fill it. */}
      <div className="setu-contact__hp" aria-hidden="true">
        <label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {/* captcha provider renders explicitly into this div once its script has loaded. */}
      <div ref={widgetRef} className="setu-contact__captcha" />
      <button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send'}
      </button>
      {status === 'error' && <p className="setu-contact__error" role="alert">Something went wrong. Please try again.</p>}
    </form>
  )
}
