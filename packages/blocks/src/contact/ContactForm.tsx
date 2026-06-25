// packages/blocks/src/contact/ContactForm.tsx
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { validateContactFields, submitContact, type ContactRequired } from '@setu/core'
import './contact.css'

export interface ContactFormProps {
  formId: string
  formLabel?: string
  apiBase: string
  /** Cloudflare Turnstile public site key (rendered into the widget). */
  siteKey: string
  subject?: boolean
  required: ContactRequired
  labels?: Record<string, string>
  placeholders?: Record<string, string>
  successMessage: string
}

/** Minimal shape of the Cloudflare Turnstile JS API we use. */
interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string
      callback: (token: string) => void
      'error-callback'?: () => void
      'expired-callback'?: () => void
    },
  ) => string
  reset: (id?: string) => void
}

const getTurnstile = (): TurnstileApi | undefined =>
  (window as unknown as { turnstile?: TurnstileApi }).turnstile

export default function ContactForm(props: ContactFormProps) {
  const { formId, formLabel, apiBase, siteKey, subject = false, required, labels = {}, placeholders = {}, successMessage } = props
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [token, setToken] = useState('')
  const widgetRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)

  // Explicit Turnstile render: wait for the async api.js to load, then render the
  // widget into our ref'd div. Avoids the auto-render race (the auto-renderer scans
  // on script load, before this island has hydrated its markup).
  useEffect(() => {
    if (!siteKey) return
    let cancelled = false
    let tries = 0
    const tryRender = () => {
      if (cancelled || widgetId.current !== null) return true
      const ts = getTurnstile()
      if (!ts || !widgetRef.current) return false
      widgetId.current = ts.render(widgetRef.current, {
        sitekey: siteKey,
        callback: (t) => setToken(t),
        'error-callback': () => setToken(''),
        'expired-callback': () => setToken(''),
      })
      return true
    }
    if (tryRender()) return
    const interval = setInterval(() => {
      tries++
      if (tryRender() || tries > 100) clearInterval(interval) // give up after ~20s
    }, 200)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [siteKey])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const fields: Record<string, string> = {
      name: String(fd.get('name') ?? ''),
      email: String(fd.get('email') ?? ''),
      message: String(fd.get('message') ?? ''),
    }
    if (subject) fields.subject = String(fd.get('subject') ?? '')

    const v = validateContactFields(fields, required)
    setErrors(v.errors)
    if (!v.ok) return

    if (token === '') {
      // Widget not solved yet (or failed to load).
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
      honeypot: String(fd.get('company') ?? ''), // honeypot field
      pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    })
    if (result.ok) {
      setStatus('done')
      form.reset()
    } else {
      setStatus('error')
      // Let the visitor retry: reset the widget + require a fresh token.
      const ts = getTurnstile()
      if (ts && widgetId.current !== null) ts.reset(widgetId.current)
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
      {/* Turnstile renders explicitly into this div once api.js has loaded. */}
      <div ref={widgetRef} className="setu-contact__turnstile" />
      <button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send'}
      </button>
      {status === 'error' && <p className="setu-contact__error" role="alert">Something went wrong. Please try again.</p>}
    </form>
  )
}
