import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { apiFetch } from '../../lib/api-fetch'
import {
  describeCapabilitiesError,
  type CapabilitiesError
} from '../../lib/useCapabilities'

interface CaptchaStatus {
  provider: string
  secretConfigured: boolean
}

type StatusRead =
  | { state: 'loading' }
  | { state: 'ok'; status: CaptchaStatus }
  | { state: 'error'; error: CapabilitiesError }

function isCaptchaStatus(body: unknown): body is CaptchaStatus {
  const o = body as Partial<CaptchaStatus> | null
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof o.provider === 'string' &&
    typeof o.secretConfigured === 'boolean'
  )
}

/** Reads `GET /forms/captcha-status`. A failed read (no answer, a non-2xx, an unreadable body) is
 *  an error state with a retry — never "not configured", because it never learned the
 *  configuration (#1176). Exercised by apps/admin/test/forms-settings.test.tsx. */
function SpamProtectionStatus({ apiBase }: { apiBase: string }) {
  const [read, setRead] = useState<StatusRead>({ state: 'loading' })
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let live = true
    void (async () => {
      let next: StatusRead
      try {
        const res = await apiFetch(`${apiBase}/forms/captcha-status`)
        if (!res.ok) {
          next = { state: 'error', error: { kind: 'http', status: res.status } }
        } else {
          let body: unknown
          try {
            body = await res.json()
          } catch {
            body = undefined
          }
          next = isCaptchaStatus(body)
            ? { state: 'ok', status: body }
            : { state: 'error', error: { kind: 'malformed' } }
        }
      } catch {
        next = { state: 'error', error: { kind: 'network' } }
      }
      if (live) setRead(next)
    })()
    return () => {
      live = false
    }
  }, [apiBase, retryKey])

  if (read.state === 'loading') {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Checking spam protection…
      </p>
    )
  }
  if (read.state === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t check spam protection.{' '}
          {describeCapabilitiesError(read.error)}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setRead({ state: 'loading' })
            setRetryKey((k) => k + 1)
          }}
        >
          Try again
        </Button>
      </div>
    )
  }
  const { provider, secretConfigured } = read.status
  if (!provider) {
    return (
      <p className="text-sm text-muted-foreground">
        Spam protection: not configured
      </p>
    )
  }
  if (secretConfigured) {
    return (
      <p className="text-sm text-muted-foreground">
        Spam protection: {provider} — secret detected ✓
      </p>
    )
  }
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">
        Spam protection: {provider} — secret missing ⚠ (set{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          SETU_{provider.toUpperCase()}_SECRET
        </code>
        )
      </p>
      {/* What createFormsCaptcha does in this state (#1163), pinned by
          apps/api/test/captcha-config.test.ts. */}
      <p className="text-xs text-muted-foreground">
        Until it is set, every form submission is rejected — except in local
        mode, where submissions pass through unverified.
      </p>
    </div>
  )
}

/** Settings → Forms. */
export function FormsSettings({ apiBase }: { apiBase: string | undefined }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Spam protection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {apiBase ? (
          <SpamProtectionStatus apiBase={apiBase} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Spam protection: not configured
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          More form settings coming soon.
        </p>
      </CardContent>
    </Card>
  )
}
