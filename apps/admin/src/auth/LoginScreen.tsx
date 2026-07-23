import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
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

/** The agreed reference (#248 Task 6): shadcn's `login-01` block — a centered Card, wordmark,
 *  email + password Inputs with Labels, a full-width primary submit. Built against real
 *  capabilities (social providers, captcha) rather than a static mock. */
export function LoginScreen() {
  const { auth } = useCapabilities()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captcha?.provider, captcha?.siteKey])

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

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <span
            aria-hidden
            className="mb-2 flex size-10 items-center justify-center"
          >
            <svg viewBox="0 0 32 32" width={36} height={36} fill="none">
              <rect
                x="1"
                y="1"
                width="30"
                height="30"
                rx="9"
                fill="var(--primary)"
              />
              <path
                d="M21.5 11.5c-1-1.4-2.8-2.2-4.9-2.2-3 0-5 1.5-5 3.8 0 2 1.4 3 4.3 3.6l1.6.4c1.5.3 2.1.8 2.1 1.6 0 1-1 1.7-2.6 1.7-1.6 0-2.8-.7-3.4-1.9"
                stroke="var(--primary-foreground)"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
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
              <Label htmlFor="login-password">Password</Label>
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
