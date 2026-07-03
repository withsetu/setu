import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/** Placeholder — replaced by the full shadcn login-01 build in the next TDD pass of this task. */
export function LoginScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Sign in to Setu</CardTitle>
          <CardDescription>Enter your credentials to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="submit" className="w-full">Sign in</Button>
        </CardContent>
      </Card>
    </div>
  )
}
