import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

/** Placeholder first-run setup screen (#248 Task 6). The real owner-creation flow
 *  (capabilities.auth.needsSetup === true, i.e. zero user rows) lands in Task 7 — this keeps the
 *  seam obvious (SessionGate already routes here) without pretending setup is implemented. */
export function SetupPending() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>First-run setup is on its way</CardTitle>
          <CardDescription>
            This Setu instance has no owner account yet. The setup screen to create one arrives
            with the next piece of work — nothing to do here yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          Check back shortly, or ask whoever is standing up this instance.
        </CardContent>
      </Card>
    </div>
  )
}
