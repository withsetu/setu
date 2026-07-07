import { useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from 'sonner'
import * as z from 'zod'
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
import { apiFetch } from '../lib/api-fetch'
import { authClient } from './auth-client'

const apiBase = import.meta.env.VITE_SETU_API ?? ''

const setupSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Enter a valid email'),
    password: z.string().min(12, 'Password must be at least 12 characters'),
    confirm: z.string(),
    token: z.string().min(1, 'Setup token is required')
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords don't match",
    path: ['confirm']
  })

type SetupFormValues = z.infer<typeof setupSchema>
type FieldErrors = Partial<Record<keyof SetupFormValues, string>>

/** Maps the setup endpoint's error response to the copy the #248 Task 7 brief specifies.
 *  `/api/auth/setup` is a plain better-auth-plugin endpoint (not part of the authClient's typed
 *  surface — see server-setup-plugin.ts), so this reads the raw JSON body/status directly rather
 *  than going through better-fetch's error shape. */
function mapSetupError(
  status: number,
  message: string | undefined
): { message: string; alreadyCompleted: boolean } {
  if (status === 403) {
    return {
      message:
        'Setup has already been completed on this instance — taking you to sign in…',
      alreadyCompleted: true
    }
  }
  if (status === 401) {
    return {
      message: "Setup token doesn't match — check your server logs",
      alreadyCompleted: false
    }
  }
  if (status === 404) {
    return {
      message: 'Setup isn’t available on this instance.',
      alreadyCompleted: false
    }
  }
  return {
    message:
      message || 'Something went wrong completing setup — please try again.',
    alreadyCompleted: false
  }
}

/** First-run server setup (#248 Task 7): the guarded one-time admin-creation flow for non-local
 *  topologies, replacing SetupPending in SessionGate's `needsSetup` branch. Same visual family as
 *  LoginScreen (shadcn login-01: centered Card, wordmark) per the task brief. */
export function SetupScreen() {
  const session = authClient.useSession()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [token, setToken] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setFormError(null)

    const parsed = setupSchema.safeParse({
      name,
      email,
      password,
      confirm,
      token
    })
    if (!parsed.success) {
      const errors: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof SetupFormValues | undefined
        if (key && !errors[key]) errors[key] = issue.message
      }
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    setSubmitting(true)
    try {
      const res = await apiFetch(`${apiBase}/api/auth/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password, token })
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string
        }
        const mapped = mapSetupError(res.status, body.message)
        setFormError(mapped.message)
        if (mapped.alreadyCompleted) {
          toast.error(mapped.message)
          setTimeout(() => window.location.reload(), 1500)
        }
        return
      }
      // Success: a real session cookie is now set. Refetch so SessionGate's useSession picks up
      // the new session immediately and swaps this screen out for the app.
      await session.refetch()
    } catch {
      setFormError('Could not reach the server — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
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
          <CardTitle className="text-xl">Set up your Setu instance</CardTitle>
          <CardDescription>
            Create the admin account to finish first-run setup.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => void onSubmit(e)}
            noValidate
            className="grid gap-4"
          >
            <div className="grid gap-2">
              <Label htmlFor="setup-name">Name</Label>
              <Input
                id="setup-name"
                name="name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!fieldErrors.name}
              />
              {fieldErrors.name && (
                <p className="text-sm text-destructive">{fieldErrors.name}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="setup-email">Email</Label>
              <Input
                id="setup-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!fieldErrors.email}
              />
              {fieldErrors.email && (
                <p className="text-sm text-destructive">{fieldErrors.email}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="setup-password">Password</Label>
              <Input
                id="setup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!fieldErrors.password}
              />
              {fieldErrors.password && (
                <p className="text-sm text-destructive">
                  {fieldErrors.password}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="setup-confirm">Confirm password</Label>
              <Input
                id="setup-confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={!!fieldErrors.confirm}
              />
              {fieldErrors.confirm && (
                <p className="text-sm text-destructive">
                  {fieldErrors.confirm}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="setup-token">Setup token</Label>
              <Input
                id="setup-token"
                name="token"
                autoComplete="off"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                aria-invalid={!!fieldErrors.token}
              />
              <p className="text-xs text-muted-foreground">
                Printed in your server logs at boot.
              </p>
              {fieldErrors.token && (
                <p className="text-sm text-destructive">{fieldErrors.token}</p>
              )}
            </div>

            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && (
                <span
                  aria-hidden
                  className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              )}
              {submitting ? 'Creating account…' : 'Create admin account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
