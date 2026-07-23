import { useState } from 'react'
import type { FormEvent } from 'react'
import * as z from 'zod'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { useNotify } from '../ui/notify'
import { passwordField } from '../lib/password-policy'
import { authClient } from './auth-client'
import type { AuthClientError } from './auth-client'

const resetSchema = z
  .object({
    newPassword: passwordField,
    confirm: z.string()
  })
  .refine((data) => data.newPassword === data.confirm, {
    message: "Passwords don't match",
    path: ['confirm']
  })
type ResetErrors = { newPassword?: string; confirm?: string }

/** Maps a `resetPassword` error to honest copy. better-auth's `/reset-password` RE-VALIDATES and
 *  CONSUMES the token on submit (verified in 1.6.23's `dist/api/routes/password.mjs` —
 *  `internalAdapter.consumeVerificationValue`), so a token that was valid when the emailed link was
 *  clicked can still fail here: already used (a double submit, or the same link opened twice), or
 *  expired in the gap between page-load and submit. Both collapse to the identical `INVALID_TOKEN`
 *  code (`@better-auth/core/error` codes.mjs: `"Invalid token"`) — there's no server signal to tell
 *  them apart, so the message doesn't pretend to. */
function mapResetError(error: AuthClientError): string {
  if (error.code === 'INVALID_TOKEN') {
    return 'This reset link has expired or was already used — ask for a new one.'
  }
  return 'Something went wrong resetting your password — please try again.'
}

/** The landing page for the emailed password-reset link (#364). better-auth's
 *  `/reset-password/:token` callback route 302s HERE with `?token=<verification token>` once it has
 *  confirmed the token exists and hasn't expired — `packages/auth/src/reset-password-email.ts`
 *  wires the DEFAULT `redirectTo` to exactly this admin-origin route (and the row-action trigger in
 *  UsersScreen.tsx passes it explicitly too, rather than relying on that default). Mirrors
 *  LoginScreen's centered-Card layout/idioms (#248 Task 6's shadcn `login-01` reference) — same
 *  shell, a different form. Mounted OUTSIDE SessionGate's auth wall (see SessionGate.tsx's
 *  `location.pathname === '/reset-password'` check) so a signed-OUT visitor can reach it at all. */
export function ResetPasswordScreen() {
  const notify = useNotify()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<ResetErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting || !token) return
    const parsed = resetSchema.safeParse({ newPassword, confirm })
    if (!parsed.success) {
      const next: ResetErrors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ResetErrors | undefined
        if (key && !next[key]) next[key] = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    setFormError(null)
    setSubmitting(true)
    try {
      const { error } = await authClient.resetPassword({
        newPassword: parsed.data.newPassword,
        token
      })
      if (error) {
        setFormError(mapResetError(error))
        return
      }
      notify.success('Password reset — sign in with your new password.')
      // Drops the token off the URL and lands on SessionGate's normal signed-out fallback
      // (LoginScreen) — there is no separate "/login" route; any pathname other than
      // "/reset-password" resolves there while signed out.
      void navigate('/')
    } catch {
      // Network-level failure REJECTS rather than returning `{ error }` — silent before (#836).
      // Same generic fallback mapResetError gives an unknown error.
      setFormError(
        'Something went wrong resetting your password — please try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-xl">Reset your password</CardTitle>
          <CardDescription>
            {token
              ? 'Choose a new password for your account.'
              : 'This reset link is missing its token — ask for a new one from the sign-in screen.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {token ? (
            <form
              onSubmit={(e) => void onSubmit(e)}
              noValidate
              className="grid gap-4"
            >
              <div className="grid gap-2">
                <Label htmlFor="reset-new-password">New password</Label>
                <Input
                  id="reset-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  aria-invalid={!!errors.newPassword}
                />
                {errors.newPassword && (
                  <p className="text-sm text-destructive">
                    {errors.newPassword}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reset-confirm">Confirm password</Label>
                <Input
                  id="reset-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-invalid={!!errors.confirm}
                />
                {errors.confirm && (
                  <p className="text-sm text-destructive">{errors.confirm}</p>
                )}
              </div>

              {formError && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Resetting…' : 'Reset password'}
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                void navigate('/')
              }}
            >
              Back to sign in
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
