import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card'

/** Full-screen, mode-aware state for when the api reports `capabilities.auth.enabled === false`
 *  (#248 Task 5's fail-closed boot degradation: no SETU_AUTH_SECRET was set in a topology that
 *  requires one). This is NOT a broken login form — there is no session to sign in to, so showing
 *  email/password inputs that can never succeed would be dishonest. */
export function AuthNotConfigured() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Auth is not configured</CardTitle>
          <CardDescription>
            This Setu instance cannot start a session yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          Set{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            SETU_AUTH_SECRET
          </code>{' '}
          in the api&apos;s environment and restart it to enable sign-in.
        </CardContent>
      </Card>
    </div>
  )
}
