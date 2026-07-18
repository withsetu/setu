import { Link } from 'react-router-dom'
import type { AuditResult } from '@setu/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { relativeTime } from '@/lib/format'
import { useAudit } from '../../health/useAudit'

const BAND: Record<AuditResult['band'], { label: string; cls: string }> = {
  strong: { label: 'Strong', cls: 'text-foreground' },
  good: { label: 'Good', cls: 'text-foreground' },
  'needs-work': { label: 'Needs work', cls: 'text-destructive' }
}

/** Presentational — takes an audit so it's easy to test. */
export function SiteHealthCardView({
  audit,
  scannedAt
}: {
  audit: AuditResult
  scannedAt?: string | null
}) {
  const band = BAND[audit.band]
  // Guard against an unparseable timestamp rendering "NaNm ago" (defensive — the
  // scan cache already rejects one, but the view is presentational + reusable).
  const scannedMs = scannedAt != null ? Date.parse(scannedAt) : NaN
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">
          Site Health
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-end justify-between">
        <div>
          <div className={`text-4xl font-bold ${band.cls}`}>{audit.score}</div>
          <div className={`text-sm font-medium ${band.cls}`}>{band.label}</div>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div>
            Must-haves:{' '}
            <span className="font-semibold text-foreground">
              {audit.mustHaves.done} / {audit.mustHaves.total}
            </span>
          </div>
          {!Number.isNaN(scannedMs) && (
            <div className="text-xs">Scanned {relativeTime(scannedMs)}</div>
          )}
          <Link to="/health" className="text-primary hover:underline">
            View report →
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

/** The "content checks haven't run on this machine yet" state (#593). The card
 *  triggers NO content scan on load — it points the admin at the Site Health
 *  screen to run the first scan, instead of walking every page on mount. */
function NotScannedCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">
          Site Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Content checks haven't been scanned yet.
        </p>
        <Link to="/health" className="text-sm text-primary hover:underline">
          Open Site Health to scan →
        </Link>
      </CardContent>
    </Card>
  )
}

function SiteHealthSkeleton() {
  // #572: skeleton shaped like the loaded card so nothing shifts on load.
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">
          Site Health
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-end justify-between">
        <div>
          <div className="flex h-10 items-center">
            <Skeleton className="h-8 w-14" />
          </div>
          <div className="flex h-5 items-center">
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="flex h-5 items-center">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="flex h-5 items-center">
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function SiteHealthCard() {
  const { audit, scannedAt } = useAudit()
  if (!audit) return <SiteHealthSkeleton />
  if (scannedAt === null) return <NotScannedCard />
  return <SiteHealthCardView audit={audit} scannedAt={scannedAt} />
}
