import type { DeployStatus } from '@setu/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { relativeTime } from '@/lib/format'

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The dashboard's saved-vs-live summary (#208): what's deployed, and how much has
 *  been saved since. Honest by design — "N changes pending — not yet live" instead of
 *  implying a commit updated the static site (CLAUDE.md card #7). */
export function SiteDeployCard({
  url,
  status,
  loadError = null,
  loading = false
}: {
  url: string
  status: DeployStatus | null
  /** The deploy status failed to load (#1158). Without it a null status reads as "Not
   *  deployed yet", which is a claim the card cannot make when it simply has no answer. */
  loadError?: string | null
  loading?: boolean
}) {
  const pendingCount = status?.changedPaths.length ?? 0
  if (loading) {
    // #572: paint the shell immediately — skeleton lines shaped like the url,
    // deploy summary, and View-site button, so nothing shifts when data lands.
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">
            Site &amp; deploy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex h-5 items-center">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex h-4 items-center">
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">
          Site &amp; deploy
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm hover:underline"
        >
          {hostOf(url)}
        </a>
        <p className="text-xs text-muted-foreground">
          {status === null && loadError !== null ? (
            <span className="text-destructive">{loadError}</span>
          ) : status === null || status.deployedSha === null ? (
            'Not deployed yet'
          ) : (
            <>
              Deployed ·{' '}
              <span className="font-mono">
                {status.deployedSha.slice(0, 7)}
              </span>
              {status.deployedAt !== null && (
                <> · {relativeTime(Date.parse(status.deployedAt))}</>
              )}
            </>
          )}
        </p>
        {status !== null && status.pending && (
          <p className="text-xs text-amber-700 dark:text-amber-500">
            {status.deployedSha === null
              ? 'Saved changes are not live yet.'
              : status.baselineUnresolvable
                ? // #1158: the diff could not be computed — the empty list means unknown, not zero.
                  "Can't tell which saved changes are live — publish to rebuild the whole site."
                : `${pendingCount} change${pendingCount === 1 ? '' : 's'} pending — not yet live.`}
          </p>
        )}
        <Button asChild variant="outline" size="sm" className="w-full">
          <a href={url} target="_blank" rel="noopener noreferrer">
            View site
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}
