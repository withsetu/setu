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
import {
  EmailTemplates,
  validateEmailTemplates,
  templatesFingerprint
} from './EmailTemplates'
import { patchEmailGroup } from './email-settings-patch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@/components/ui/select'

const SETTINGS_PATH = 'settings.json'
const apiBase = import.meta.env.VITE_SETU_API ?? ''

type TransportId = 'console' | 'resend' | 'smtp'

/** Mirrors apps/api/src/email.ts's EmailStatus — presence booleans only, never key material. */
interface EmailStatus {
  /** The RESOLVED provider selection (settings win, SETU_EMAIL_ADAPTER is the fallback). */
  transport: string
  /** Which of the two chose it — drives the "chosen here / from the environment" hint. */
  providerSource: 'settings' | 'env' | 'default'
  /** Per-transport usability for the picker; `problem` is the remediation to show on a
   *  disabled option (#890). */
  transports: { id: TransportId; usable: boolean; problem: string | null }[]
  effectiveTransport: TransportId
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

const TRANSPORT_LABELS: Record<TransportId, string> = {
  console: 'Console (dev)',
  resend: 'Resend',
  smtp: 'SMTP'
}

const TRANSPORT_HINTS: Record<TransportId, string> = {
  console: 'Logs emails to the API server console — nothing is delivered.',
  resend: 'Delivers over Resend’s HTTP API. Works on every topology.',
  smtp: 'Delivers over SMTP. Needs a Node server — not available on the edge.'
}

const isTransportId = (v: string): v is TransportId =>
  v === 'console' || v === 'resend' || v === 'smtp'

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

/** Provider status card. The provider is a CONTROL (#890 — a status label where a control
 *  belongs is the raw-text-box failure mode); everything else is read-only server truth from
 *  GET /api/email/status. Secrets are presence-only ("set via env ✓"), never values — the
 *  dropdown only ever exposes WHICH transports are configured, exactly what the secrets rows
 *  already showed. */
function ProviderStatus({
  status,
  loading,
  failed,
  onRetry,
  provider,
  onProviderChange,
  providerDirty
}: {
  status: EmailStatus | null
  loading: boolean
  failed: boolean
  onRetry: () => void
  /** The transport shown in the picker — the pending settings value, falling back to whatever
   *  the server currently resolves (which may come from SETU_EMAIL_ADAPTER). */
  provider: string
  onProviderChange: (next: TransportId) => void
  providerDirty: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Email delivery</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
            <div className="space-y-1.5">
              <Label htmlFor="email-provider">Provider</Label>
              <Select
                value={isTransportId(provider) ? provider : undefined}
                onValueChange={(v) => {
                  if (isTransportId(v)) onProviderChange(v)
                }}
              >
                <SelectTrigger id="email-provider" className="w-full">
                  <SelectValue placeholder="Not recognized — choose one" />
                </SelectTrigger>
                <SelectContent>
                  {status.transports.map((t) => (
                    <SelectItem
                      key={t.id}
                      value={t.id}
                      disabled={!t.usable}
                      // A disabled option must say WHY and what to add — a greyed-out row with
                      // no reason is a dead control, and offering it as selectable would be
                      // worse still (it would silently fall back to console).
                      description={t.usable ? TRANSPORT_HINTS[t.id] : t.problem}
                    >
                      {TRANSPORT_LABELS[t.id]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {providerDirty ? (
                <p className="text-sm text-muted-foreground">
                  Not applied yet — use Save changes below to switch.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {status.providerSource === 'settings'
                    ? 'Chosen here, in Settings.'
                    : status.providerSource === 'env'
                      ? 'Currently set by the server’s SETU_EMAIL_ADAPTER variable — choosing one here overrides it.'
                      : 'No provider configured anywhere yet — Setu defaults to the console.'}
                </p>
              )}
            </div>

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
                  : ' Pick Resend or SMTP above to deliver real email; if either is disabled, add its credentials to the server environment first.'}
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
  const providerDirty =
    published !== null && values.provider !== published.provider
  // #499: templates join the SAME dirty state and the SAME Save button as the rest of the
  // group — a from-address edit and a template edit are one commit and one "Saved" state,
  // which is why Increment A put the provider control in the status card but kept its Save
  // here. Key order in JSON is not meaningful, hence the sorted fingerprint.
  const templateErrors = validateEmailTemplates(values.templates)
  const hasTemplateErrors = Object.keys(templateErrors).length > 0
  const dirty =
    published !== null &&
    (trimmed !== published.fromAddress ||
      values.provider !== published.provider ||
      templatesFingerprint(values.templates) !==
        templatesFingerprint(published.templates))

  // #890: what the picker shows. The stored value wins when set; otherwise the server's
  // resolved selection (which came from SETU_EMAIL_ADAPTER) — so an instance that has never
  // used this screen still shows the transport it is actually using, rather than a blank
  // control claiming nothing is configured.
  const shownProvider = values.provider || (status?.transport ?? '')

  const save = async () => {
    if (saving || !dirty || raw === null || published === null) return
    if (hasTemplateErrors) return
    if (!fromAddressSchema.safeParse(trimmed).success) {
      setFieldError(FROM_ERROR)
      return
    }
    setSaving(true)
    try {
      // #937: PATCH the stored group with what changed — never write the loaded group back
      // whole. `values` is the SALVAGED reading, so writing it back erased every stored value
      // the salvage layer had rejected (a `git push`-ed provider, an oversized template, a
      // plugin's namespaced template id) as a side effect of an unrelated edit, under a
      // "Settings saved" toast. See email-settings-patch.ts;
      // apps/admin/test/email-settings-patch.test.ts pins each case.
      const next = {
        ...raw,
        email: patchEmailGroup(raw.email, published, {
          ...values,
          fromAddress: trimmed
        })
      }
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
      // The effective transport, from-address and their sources may all have changed — and
      // the api applies them to the NEXT email with no restart (#890), so re-reading the
      // status here is the screen telling the truth, not an optimistic guess.
      setStatusKey((k) => k + 1)
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
    <div className="space-y-8">
      {/* One form for the whole email group: the provider picker lives in the status card
          (that is where the transport is reported, so that is where it must be changeable)
          while Save sits with the rest of the group, so a switch, a from-address edit and a
          template edit are one commit and one "Saved" state instead of three competing ones.
          Delivery config stays narrow; the template editor below needs the width for its
          side-by-side preview, so the max-width lives on the inner block, not the form. */}
      <form
        className="space-y-8"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="max-w-xl space-y-6">
          <ProviderStatus
            status={status}
            loading={statusLoading}
            failed={statusFailed}
            onRetry={() => {
              setStatusFailed(false)
              setStatusKey((k) => k + 1)
            }}
            provider={shownProvider}
            onProviderChange={(next) =>
              // Spread-patch, like the from-address below — never a whole-object replace.
              setValues((v) => ({ ...v, provider: next }))
            }
            providerDirty={providerDirty}
          />

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
            Email settings apply as soon as you save — emails are sent live by
            the API, so no site rebuild or redeploy is needed.
          </p>
        </div>

        <EmailTemplates
          overrides={values.templates}
          errors={templateErrors}
          onChange={(templates) =>
            // Spread-patch like every other field here — never a whole-object replace, or the
            // unknown future keys parseSettings passed through would be dropped from the next
            // save (apps/admin/test/email-templates.test.tsx pins their survival).
            setValues((v) => ({ ...v, templates }))
          }
        />

        <Button
          type="submit"
          disabled={published === null || !dirty || saving || hasTemplateErrors}
        >
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </form>

      <div className="max-w-xl border-t pt-5 space-y-2">
        <p className="text-sm font-medium">Send a test email</p>
        <p className="text-xs text-muted-foreground">
          Sends a fixed test message to your own account email — the recipient
          can&rsquo;t be chosen.
        </p>
        {/* #890: `dirty` now covers the provider too, so this can no longer name the
            from-address alone — the test send goes through whatever is SAVED, both fields. */}
        {dirty && (
          <p className="text-xs text-muted-foreground">
            You have unsaved changes — the test uses the saved provider and
            from-address, not the ones above.
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
