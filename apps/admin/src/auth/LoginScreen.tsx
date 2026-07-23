import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import * as z from 'zod'
import { mountCaptcha } from '@setu/blocks/mount-captcha'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCapabilities } from '../lib/useCapabilities'
import { authClient } from './auth-client'
import type { AuthClientError } from './auth-client'

const SOCIAL_LABEL: Record<'github' | 'google', string> = {
  github: 'GitHub',
  google: 'Google'
}

/** Maps a Better Auth / better-fetch sign-in error to user-facing copy.
 *
 *  #248 Task 7 correction: this used to special-case a `CREDENTIAL_ACCOUNT_NOT_FOUND` code as the
 *  "passwordless owner" signal. Verified against better-auth 1.6.23 source
 *  (node_modules/better-auth/dist/api/routes/sign-in.mjs) that `/sign-in/email` does NOT
 *  distinguish "no credential account exists" from "wrong password" — both throw the identical
 *  `UNAUTHORIZED` / `INVALID_EMAIL_OR_PASSWORD`, deliberately (each branch calls
 *  `ctx.context.password.hash(password)` before throwing, purely to equalize timing across the
 *  branches — a textbook anti-user-enumeration measure). `CREDENTIAL_ACCOUNT_NOT_FOUND` DOES exist
 *  in better-auth's error codes, but is only thrown by `/update-user` (changing your own
 *  password), never by sign-in — so this mapping could never have matched in production.
 *
 *  Per the #248 Task 7 brief, the honest fix is to accept the generic message rather than fake a
 *  distinction better-auth's own sign-in route does not make: a passwordless local-owner account
 *  hit with any password now surfaces the same "Email or password is incorrect" as a real wrong
 *  password. (A local owner should be using the loopback handshake, not password sign-in, anyway
 *  — this path is only reachable for remote/hosted sign-in attempts against that account.) */
function mapSignInError(error: AuthClientError): string {
  if (error.status === 429)
    return 'Too many attempts — wait a moment and try again.'
  if (error.status === 401 || error.code === 'INVALID_EMAIL_OR_PASSWORD') {
    return 'Email or password is incorrect.'
  }
  return 'Something went wrong signing in — please try again.'
}

const forgotSchema = z.object({
  email: z.string().email('Enter a valid email')
})

/** Maps a `requestPasswordReset` failure to visible copy (#500). Enumeration safety lives on the
 *  SERVER: better-auth 1.6.24's `/request-password-reset` answers the identical `{ status: true }`
 *  whether or not the account exists (verified in the installed package's
 *  dist/api/routes/password.mjs — the unknown-email branch even simulates the token work to
 *  equalize timing). So any `error` reaching this mapper is a REAL failure — transport, rate
 *  limit, or server misconfiguration — and must be reported as one, never disguised as the
 *  uniform "we've sent a link" success copy (CLAUDE.md §3.2 silent-async rule; exercised by
 *  apps/admin/test/login-screen.test.tsx's "failed request surfaces a visible error" cases). */
function mapResetRequestError(error: AuthClientError): string {
  if (error.status === 429)
    return 'Too many attempts — wait a moment and try again.'
  return "Couldn't send the reset email — please try again."
}

/** The Setu wordmark atop both login-flow cards — extracted so the forgot-password card shares
 *  the sign-in card's exact header chrome instead of forking a lookalike. */
function Wordmark() {
  return (
    <span aria-hidden className="mx-auto mb-2 flex size-10 items-center justify-center">
      <svg viewBox="0 0 32 32" width={36} height={36} fill="none">
        <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--primary)" />
        <path
          d="M21.5 11.5c-1-1.4-2.8-2.2-4.9-2.2-3 0-5 1.5-5 3.8 0 2 1.4 3 4.3 3.6l1.6.4c1.5.3 2.1.8 2.1 1.6 0 1-1 1.7-2.6 1.7-1.6 0-2.8-.7-3.4-1.9"
          stroke="var(--primary-foreground)"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

/** #500: the "Forgot password?" step. Capability-aware: when reset emails can't actually go out
 *  (`email.deliverable` false — console/dev transport, or no from-address), it shows honest
 *  not-configured copy instead of an email form whose submit could only dead-end. When capability
 *  state is UNKNOWN (capabilities fetch failed), it fails closed to the same honest copy rather
 *  than promising an email it can't vouch for.
 *
 *  Success copy is deliberately uniform ("If an account exists…") regardless of account
 *  existence — matching the server's own enumeration-safe response. Failures (transport, 429) are
 *  the one thing that MUST break that uniformity: see mapResetRequestError's comment.
 *
 *  Captcha (#500 review Finding 1): better-auth's captcha plugin protects
 *  `/request-password-reset` BY DEFAULT (verified in installed 1.6.24:
 *  dist/plugins/captcha/constants.mjs `defaultEndpoints`; a missing `x-captcha-response` header
 *  400s before the route runs), so on a captcha-configured deployment this form mounts its own
 *  widget and threads the token exactly like the sign-in form — otherwise every submit would
 *  dead-end. Exercised by apps/admin/test/login-screen.test.tsx ("captcha configured: forgot
 *  submit stays disabled…"). */
function ForgotPasswordCard({
  deliverable,
  initialEmail,
  captcha,
  onBack
}: {
  deliverable: boolean
  initialEmail: string
  captcha: { provider: 'turnstile' | 'recaptcha'; siteKey: string } | null
  onBack: () => void
}) {
  const [email, setEmail] = useState(initialEmail)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const widgetRef = useRef<HTMLDivElement>(null)
  const captchaHandle = useRef<{
    reset: () => void
    cleanup: () => void
  } | null>(null)

  // The widget's DOM node only exists while the form shows (deliverable, not yet sent).
  const showForm = deliverable && !sent

  useEffect(() => {
    if (!captcha || !showForm || !widgetRef.current) return
    const handle = mountCaptcha({
      provider: captcha.provider,
      siteKey: captcha.siteKey,
      el: widgetRef.current,
      onToken: setCaptchaToken
    })
    captchaHandle.current = handle
    return () => {
      handle.cleanup()
      captchaHandle.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captcha?.provider, captcha?.siteKey, showForm])

  const captchaPending = !!captcha && captchaToken === ''

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting || sent || captchaPending) return
    const parsed = forgotSchema.safeParse({ email })
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Enter a valid email')
      return
    }
    setFieldError(null)
    setError(null)
    setSubmitting(true)
    try {
      const { error: requestError } = await authClient.requestPasswordReset(
        {
          email: parsed.data.email,
          // Explicit, same-origin redirect (mirrors the Users screen's reset trigger):
          // better-auth origin-checks it, and the emailed link lands on our /reset-password
          // screen.
          redirectTo: `${window.location.origin}/reset-password`
        },
        captchaToken
          ? { headers: { 'x-captcha-response': captchaToken } }
          : undefined
      )
      if (requestError) {
        setError(mapResetRequestError(requestError))
        // Captcha tokens are single-use: the failed request consumed this one, so re-arm the
        // widget before the retry the error copy invites.
        captchaHandle.current?.reset()
        setCaptchaToken('')
        return
      }
      setSent(true)
    } catch {
      // A thrown (network-level) failure is still a failure the user is waiting on — report it,
      // never let it collapse into silence or fake the uniform success copy (CLAUDE.md §3.2).
      setError("Couldn't send the reset email — please try again.")
      captchaHandle.current?.reset()
      setCaptchaToken('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <Wordmark />
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>
          {!deliverable
            ? 'Password reset isn’t configured for this site — contact your site administrator.'
            : sent
              ? 'If an account exists for that email, we’ve sent a password reset link. Check your inbox.'
              : 'Enter your email and we’ll send you a reset link.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {deliverable && !sent ? (
          <form
            onSubmit={(e) => void onSubmit(e)}
            noValidate
            className="grid gap-4"
          >
            <div className="grid gap-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!fieldError}
              />
              {fieldError && (
                <p className="text-sm text-destructive">{fieldError}</p>
              )}
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            {captcha && (
              <div className="grid gap-1.5">
                <div ref={widgetRef} />
                {captchaPending && (
                  <p className="text-xs text-muted-foreground">
                    Complete the challenge above to continue.
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={submitting || captchaPending}
            >
              {submitting && (
                <span
                  aria-hidden
                  className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              )}
              {submitting ? 'Sending…' : 'Send reset link'}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={onBack}
            >
              Back to sign in
            </Button>
          </form>
        ) : (
          <div className="grid gap-4">
            {sent && (
              <p role="status" className="sr-only">
                Reset link requested.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={onBack}
            >
              Back to sign in
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** The agreed reference (#248 Task 6): shadcn's `login-01` block — a centered Card, wordmark,
 *  email + password Inputs with Labels, a full-width primary submit. Built against real
 *  capabilities (social providers, captcha) rather than a static mock. */
export function LoginScreen() {
  const { auth, email: emailCaps } = useCapabilities()
  const [view, setView] = useState<'signin' | 'forgot'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState('')
  const widgetRef = useRef<HTMLDivElement>(null)
  const captchaHandle = useRef<{
    reset: () => void
    cleanup: () => void
  } | null>(null)

  const captcha = auth?.captcha ?? null
  const providers = auth?.providers ?? []

  useEffect(() => {
    // Any previously issued token is stale whenever this effect re-runs (provider changed, or the
    // widget was unmounted by a switch to the forgot step) — clear it so the submit gate can't
    // ride a token the remounted widget never issued. Enforced by
    // apps/admin/test/login-screen.test.tsx ("captcha survives a round trip to the forgot step").
    setCaptchaToken('')
    if (!captcha || !widgetRef.current) return
    const handle = mountCaptcha({
      provider: captcha.provider,
      siteKey: captcha.siteKey,
      el: widgetRef.current,
      onToken: setCaptchaToken
    })
    captchaHandle.current = handle
    return () => {
      handle.cleanup()
      captchaHandle.current = null
    }
    // `view` is a dep so returning from the forgot step re-mounts the captcha widget (its DOM node
    // is unmounted while the forgot card is showing) — same test as above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captcha?.provider, captcha?.siteKey, view])

  const captchaPending = !!captcha && captchaToken === ''

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting || captchaPending) return
    setError(null)
    setSubmitting(true)
    try {
      const { error: signInError } = await authClient.signIn.email(
        { email, password },
        captchaToken
          ? { headers: { 'x-captcha-response': captchaToken } }
          : undefined
      )
      if (signInError) {
        setError(mapSignInError(signInError))
        captchaHandle.current?.reset()
        setCaptchaToken('')
      }
      // On success, SessionGate's useSession picks up the new session and swaps this screen out —
      // nothing to navigate to here.
    } catch {
      // A network-level failure REJECTS instead of returning `{ error }` (better-fetch awaits
      // fetch() unguarded and this client sets no catchAllError) — silent before (#836). Surface
      // the SAME generic copy mapSignInError gives an unknown error, so a failed reach is
      // indistinguishable from any other failure and never hints at whether the account exists.
      setError('Something went wrong signing in — please try again.')
      captchaHandle.current?.reset()
      setCaptchaToken('')
    } finally {
      setSubmitting(false)
    }
  }

  if (view === 'forgot') {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
        <ForgotPasswordCard
          deliverable={emailCaps?.deliverable === true}
          initialEmail={email}
          captcha={captcha}
          onBack={() => setView('signin')}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Wordmark />
          <CardTitle className="text-xl">Sign in to Setu</CardTitle>
          <CardDescription>
            Enter your email and password to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => void onSubmit(e)}
            noValidate
            className="grid gap-4"
          >
            <div className="grid gap-2">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="login-password">Password</Label>
                {/* #500: always shown — the forgot step itself is capability-aware (honest
                    not-configured copy when reset emails can't go out), so this is never a
                    dead end. shadcn login-01's inline "Forgot your password?" placement. */}
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => setView('forgot')}
                >
                  Forgot password?
                </button>
              </div>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            {captcha && (
              <div className="grid gap-1.5">
                <div ref={widgetRef} />
                {captchaPending && (
                  <p className="text-xs text-muted-foreground">
                    Complete the challenge above to continue.
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={submitting || captchaPending}
            >
              {submitting && (
                <span
                  aria-hidden
                  className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              )}
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>

            {providers.length > 0 && (
              <>
                <div className="relative text-center text-xs text-muted-foreground after:absolute after:inset-x-0 after:top-1/2 after:-z-10 after:border-t after:border-border">
                  <span className="relative bg-card px-2">
                    Or continue with
                  </span>
                </div>
                <div className="grid gap-2">
                  {providers.map((provider) => (
                    <Button
                      key={provider}
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() =>
                        void authClient.signIn.social({ provider })
                      }
                    >
                      Continue with {SOCIAL_LABEL[provider]}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
