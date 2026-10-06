import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import {
  describeCapabilitiesError,
  type CapabilitiesError
} from '../lib/useCapabilities'

/** Gentle backoff between automatic retries while this screen is up: quick at first (a restart is
 *  usually over in seconds), then settling at 30 s so a long outage doesn't hammer the API. */
export const AUTO_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 30000] as const

/** Full-screen state for when the admin could not reach the API: SessionGate shows it for a failed
 *  `/api/capabilities` read (#1165), and Bootstrap for a failed startup read (#1181), so one outage
 *  looks the same — and recovers on its own — whichever request hit it first. Distinct from
 *  AuthNotConfigured on purpose: a failed read says nothing about how the server is configured, so
 *  telling the visitor to set SETU_AUTH_SECRET would send them to fix the wrong thing. Same card
 *  layout as AuthNotConfigured; offers Retry and also retries itself with backoff. Exercised by
 *  apps/admin/test/session-gate.test.tsx ("API unreachable" cases) and
 *  apps/admin/test/bootstrap-api-unreachable.test.tsx. */
export function ApiUnreachable({
  error,
  onRetry,
  description = 'The admin needs the API to sign you in.'
}: {
  error: CapabilitiesError
  /** Re-runs the failed read. Must not reject, and must hand this screen a FRESH `error` object
   *  when it fails again — that is what schedules the next automatic attempt. useCapabilities'
   *  refetch (apps/admin/test/use-capabilities.test.tsx) and Bootstrap's retry
   *  (apps/admin/test/bootstrap-api-unreachable.test.tsx) both do. */
  onRetry: () => Promise<void>
  /** What the admin needed the API for — the line under the title. */
  description?: string
}) {
  const [retrying, setRetrying] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const attempt = useRef(0)

  const retry = useCallback(async () => {
    // Counted when an attempt STARTS (not in the scheduling effect) so StrictMode's double effect
    // run can't skip a backoff step.
    attempt.current += 1
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }, [onRetry])

  // Each failed attempt (automatic or a Retry click) hands this screen a fresh `error` object,
  // which schedules the next automatic try one backoff step later. Success unmounts the screen, which cancels it.
  useEffect(() => {
    const delay =
      AUTO_RETRY_DELAYS_MS[
        Math.min(attempt.current, AUTO_RETRY_DELAYS_MS.length - 1)
      ]!
    const due = Date.now() + delay
    setSecondsLeft(Math.ceil(delay / 1000))
    const tick = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((due - Date.now()) / 1000)))
    }, 1000)
    const timer = setTimeout(() => void retry(), delay)
    return () => {
      clearInterval(tick)
      clearTimeout(timer)
    }
  }, [error, retry])

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md" role="alert">
        <CardHeader className="text-center">
          <CardTitle>Can&apos;t reach the Setu API</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-center text-sm text-muted-foreground">
          <p>{describeCapabilitiesError(error)}</p>
          <Button
            type="button"
            className="w-full"
            disabled={retrying}
            onClick={() => void retry()}
          >
            {retrying && (
              <span
                aria-hidden
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
          <p className="text-xs" aria-live="polite">
            {retrying || secondsLeft === null
              ? 'Checking the API…'
              : `Trying again automatically in ${secondsLeft} s.`}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
