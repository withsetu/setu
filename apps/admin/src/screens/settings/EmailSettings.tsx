import { useEffect, useState } from 'react'
import { z } from 'zod'
import { parseSettings, DEFAULT_SETTINGS } from '@setu/core'
import type { EmailSettings as EmailValues } from '@setu/core'
import { useServices, OWNER_AUTHOR } from '../../data/store'
import { useNotify } from '../../ui/notify'
import { connectionError } from '../../ui/error-message'
import { apiFetch } from '../../lib/api-fetch'
import {
  SettingsLoadError,
  SETTINGS_LOAD_FAILED_MESSAGE
} from './SettingsLoadError'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const SETTINGS_PATH = 'settings.json'
const apiBase = import.meta.env.VITE_SETU_API ?? ''

/** Mirrors apps/api/src/email.ts's EmailStatus — presence booleans only, never key material. */
interface EmailStatus {
  transport: string
  effectiveTransport: 'console' | 'resend' | 'smtp'
  deliverable: boolean
  mode: string
  from: { effective: string | null; source: 'settings' | 'env' | null }
  secrets: {
    resendApiKey: boolean
    smtpConfigured: boolean
    smtpProblem: string | null
  }
  /** True when password reset was NOT wired at boot (no from-address existed then) but the
   *  live config now has one — the one email path that needs a server restart to pick the
   *  saved from-address up. Rendered as an explicit "after the server restarts" line. */
  resetRestartRequired: boolean
}

const TRANSPORT_LABELS: Record<EmailStatus['effectiveTransport'], string> = {
  console: 'Console (dev)',
  resend: 'Resend',
  smtp: 'SMTP'
}

const FROM_ERROR = 'Enter a valid email address, e.g. hello@example.com.'
// Empty is a valid stored value: "not set — fall back to SETU_FORMS_NOTIFY_FROM".
const fromAddressSchema = z.union([z.literal(''), z.string().email()])

interface SendResult {
  result: 'sent' | 'logged'
  transport: string
  to: string
}

/** One status line, whole-line muted — the SpamProtectionStatus precedent (Settings.tsx),
 *  and a single text node so tests can match the full sentence. */
function StatusRow({ label, children }: { label: string; children: string }) {
  return (
    <p className="text-sm text-muted-foreground">{`${label}: ${children}`}</p>
  )
}

/** Provider status card — everything here is read-only server truth from
 *  GET /api/email/status. Secrets are presence-only ("set via env ✓"), never values. */
function ProviderStatus({
  status,
  loading,
  failed,
  onRetry
}: {
  status: EmailStatus | null
  loading: boolean
  failed: boolean
  onRetry: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Email delivery</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">
            Checking email delivery status…
          </p>
        ) : failed || status === null ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              Couldn&rsquo;t load email delivery status. The Setu API may be
              unreachable.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm">
              <span className="text-muted-foreground">Transport: </span>
              <span className="font-medium">
                {TRANSPORT_LABELS[status.effectiveTransport]}
              </span>
            </p>

            {status.effectiveTransport === 'console' &&
              status.transport === 'smtp' &&
              status.secrets.smtpProblem && (
                <p className="text-sm text-destructive">
                  SMTP is selected but not usable: {status.secrets.smtpProblem}.
                  Emails fall back to the console until this is fixed on the
                  server.
                </p>
              )}
            {status.effectiveTransport === 'console' &&
              status.transport === 'resend' && (
                <p className="text-sm text-destructive">
                  Resend is selected but its API key is missing — emails fall
                  back to the console until RESEND_API_KEY is set in the server
                  environment.
                </p>
              )}
            {status.effectiveTransport === 'console' &&
              status.transport !== 'smtp' &&
              status.transport !== 'resend' &&
              status.transport !== 'console' && (
                <p className="text-sm text-destructive">
                  The configured transport &ldquo;{status.transport}&rdquo;
                  isn&rsquo;t recognized — emails fall back to the console.
                </p>
              )}
            {status.effectiveTransport === 'console' && (
              <p className="text-sm text-muted-foreground">
                Emails are logged to the API server&rsquo;s console, not sent.
                {status.mode === 'local'
                  ? ' The console transport is the default in local mode — fine for development.'
                  : ' Set SETU_EMAIL_ADAPTER=resend or SETU_EMAIL_ADAPTER=smtp in the server environment to deliver real email.'}
              </p>
            )}

            {/* Secret-presence rows key on the SELECTED transport, so a resend boot with no
                key still shows the red "missing ✗" line instead of hiding it behind the
                console fallback (#885 review Finding 2). */}
            {status.transport === 'resend' && (
              <StatusRow label="API key (RESEND_API_KEY)">
                {status.secrets.resendApiKey
                  ? 'set via env ✓'
                  : 'missing ✗ — set it in the server environment'}
              </StatusRow>
            )}
            {status.transport === 'smtp' && (
              <StatusRow label="SMTP connection (SETU_SMTP_*)">
                {status.secrets.smtpConfigured
                  ? 'configured via env ✓'
                  : 'not configured ✗'}
              </StatusRow>
            )}

            <StatusRow label="From address">
              {status.from.effective
                ? `${status.from.effective} — from ${
                    status.from.source === 'settings'
                      ? 'Settings (this screen)'
                      : 'the server environment (SETU_FORMS_NOTIFY_FROM)'
                  }`
                : 'not set — add one below, or set SETU_FORMS_NOTIFY_FROM on the server'}
            </StatusRow>

            {status.deliverable && (
              <p className="text-sm font-medium">Ready to send ✓</p>
            )}
            {!status.deliverable &&
              status.effectiveTransport !== 'console' &&
              !status.from.effective && (
                <p className="text-sm text-muted-foreground">
                  Not ready — add a from-address below to enable sending.
                </p>
              )}
            {status.resetRestartRequired && (
              <p className="text-sm text-destructive">
                Password reset emails will start working after the server
                restarts — the from-address was added after this server started.
                Everything else uses it right away.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function EmailSettings() {
  const { git } = useServices()
  const notify = useNotify()

  // settings.json state — the same load/save shape as GeneralSettings (preserve
  // unknown groups on save; malformed file swallowed to {} → defaults).
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null)
  const [values, setValues] = useState<EmailValues>(DEFAULT_SETTINGS.email)
  const [published, setPublished] = useState<EmailValues | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [fieldError, setFieldError] = useState<string | null>(null)

  // Provider status — error state is distinguishable from loading/empty and offers a
  // retry (the MediaGrid reference shape; CLAUDE.md §3.2 silent-async rule).
  const [status, setStatus] = useState<EmailStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusFailed, setStatusFailed] = useState(false)
  const [statusKey, setStatusKey] = useState(0)

  // Test send.
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<SendResult | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const content = await git.readFile(SETTINGS_PATH)
        let parsedRaw: Record<string, unknown> = {}
        try {
          parsedRaw = content
            ? (JSON.parse(content) as Record<string, unknown>)
            : {}
        } catch {
          parsedRaw = {}
        }
        const email = parseSettings(parsedRaw).email
        if (!live) return
        setRaw(parsedRaw)
        setValues(email)
        setPublished(email)
        setLoadFailed(false)
      } catch (err) {
        if (!live) return
        console.error('[settings] reading email settings failed', err)
        setLoadFailed(true)
        notify.error(SETTINGS_LOAD_FAILED_MESSAGE)
      }
    })()
    return () => {
      live = false
    }
  }, [git, notify, retryKey])

  useEffect(() => {
    let live = true
    setStatusLoading(true)
    void (async () => {
      try {
        const res = await apiFetch(`${apiBase}/api/email/status`)
        if (!live) return
        if (!res.ok) throw new Error(`status ${res.status}`)
        setStatus((await res.json()) as EmailStatus)
        setStatusFailed(false)
      } catch {
        if (!live) return
        setStatus(null)
        setStatusFailed(true)
      } finally {
        if (live) setStatusLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [statusKey])

  // #885 review Finding 6: compare (and save) the TRIMMED value, so padding the published
  // address with whitespace never arms the Save button or commits a cosmetic diff.
  const trimmed = values.fromAddress.trim()
  const dirty = published !== null && trimmed !== published.fromAddress

  const save = async () => {
    if (saving || !dirty || raw === null) return
    if (!fromAddressSchema.safeParse(trimmed).success) {
      setFieldError(FROM_ERROR)
      return
    }
    setSaving(true)
    try {
      const next = { ...raw, email: { ...values, fromAddress: trimmed } }
      await git.commitFile({
        path: SETTINGS_PATH,
        content: JSON.stringify(next, null, 2) + '\n',
        message: 'chore(settings): update email settings',
        author: OWNER_AUTHOR
      })
      setRaw(next)
      setValues((v) => ({ ...v, fromAddress: trimmed }))
      setPublished({ ...values, fromAddress: trimmed })
      notify.success('Settings saved')
      setStatusKey((k) => k + 1) // the effective from-address / source may have changed
    } catch {
      // #852: git.commitFile transport failure — curate rather than echo it.
      notify.error(connectionError('save your settings'))
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async () => {
    if (sending) return
    setSending(true)
    setSendResult(null)
    try {
      const res = await apiFetch(`${apiBase}/api/email/test-send`, {
        method: 'POST'
      })
      const body = (await res.json().catch(() => null)) as
        (SendResult & { message?: string; reason?: string }) | null
      if (res.ok && body) {
        setSendResult(body)
        if (body.result === 'logged')
          notify.info('Test email logged to the server console')
        else notify.success('Test email sent')
      } else if (res.status === 409) {
        notify.error(
          body?.message ??
            'No from-address is configured — add one below first.'
        )
      } else if (res.status === 429) {
        notify.error('Too many test emails — wait a minute and try again.')
      } else if (res.status === 502) {
        notify.error(
          `Test email failed: ${body?.reason ?? 'the transport rejected the send'}`
        )
      } else {
        notify.error(connectionError('send a test email'))
      }
    } catch {
      notify.error(connectionError('send a test email'))
    } finally {
      setSending(false)
    }
  }

  if (loadFailed && published === null) {
    return (
      <SettingsLoadError
        onRetry={() => {
          setLoadFailed(false)
          setRetryKey((k) => k + 1)
        }}
      />
    )
  }

  return (
    <div className="max-w-xl space-y-6">
      <ProviderStatus
        status={status}
        loading={statusLoading}
        failed={statusFailed}
        onRetry={() => {
          setStatusFailed(false)
          setStatusKey((k) => k + 1)
        }}
      />

      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="email-from">From address</Label>
          <Input
            id="email-from"
            inputMode="email"
            autoComplete="email"
            value={values.fromAddress}
            onChange={(e) => {
              setFieldError(null)
              // Spread-patch (the GeneralSettings pattern), NEVER a whole-object replace:
              // parseSettings passes unknown future keys inside the email group through
              // (e.g. #499's templates), and `values` carries them at runtime — replacing
              // the object here would silently drop them from the next save
              // (apps/admin/test/email-settings.test.tsx pins survival; #885 review
              // Finding 4).
              setValues((v) => ({ ...v, fromAddress: e.target.value }))
            }}
            placeholder="hello@example.com"
            aria-invalid={fieldError !== null}
            aria-describedby={
              fieldError !== null ? 'email-from-error' : 'email-from-help'
            }
          />
          {fieldError !== null && (
            <p id="email-from-error" className="text-sm text-destructive">
              {fieldError}
            </p>
          )}
          <p id="email-from-help" className="text-xs text-muted-foreground">
            The sender for every email this site sends — password resets and
            form notifications. Overrides the server&rsquo;s
            SETU_FORMS_NOTIFY_FROM variable; leave empty to fall back to it.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Email settings apply as soon as you save — emails are sent live by the
          API, so no site rebuild or redeploy is needed.
        </p>
        <Button type="submit" disabled={published === null || !dirty || saving}>
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </form>

      <div className="border-t pt-5 space-y-2">
        <p className="text-sm font-medium">Send a test email</p>
        <p className="text-xs text-muted-foreground">
          Sends a fixed test message to your own account email — the recipient
          can&rsquo;t be chosen.
        </p>
        {dirty && (
          <p className="text-xs text-muted-foreground">
            You have unsaved changes — the test uses the last saved
            from-address.
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => void sendTest()}
          disabled={sending || statusLoading || status === null}
        >
          {sending ? 'Sending…' : 'Send test email'}
        </Button>
        {sendResult !== null &&
          (sendResult.result === 'sent' ? (
            <p className="text-sm">
              Sent to {sendResult.to} via{' '}
              {TRANSPORT_LABELS[
                sendResult.transport as EmailStatus['effectiveTransport']
              ] ?? sendResult.transport}
              . Check your inbox.
            </p>
          ) : (
            <p className="text-sm">
              Logged to the API server console — nothing was delivered. Find it
              in the api terminal.
            </p>
          ))}
      </div>
    </div>
  )
}
