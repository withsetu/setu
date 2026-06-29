import { Link } from 'react-router-dom'
import type { AuditResult } from '@setu/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAudit } from '../../health/useAudit'

const BAND: Record<AuditResult['band'], { label: string; cls: string }> = {
  strong: { label: 'Strong', cls: 'text-green-600' },
  good: { label: 'Good', cls: 'text-amber-600' },
  'needs-work': { label: 'Needs work', cls: 'text-red-600' },
}

/** Presentational — takes an audit so it's easy to test. */
export function SiteHealthCardView({ audit }: { audit: AuditResult }) {
  const band = BAND[audit.band]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">Site Health</CardTitle>
      </CardHeader>
      <CardContent className="flex items-end justify-between">
        <div>
          <div className={`text-4xl font-bold ${band.cls}`}>{audit.score}</div>
          <div className={`text-sm font-medium ${band.cls}`}>{band.label}</div>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div>Must-haves: <span className="font-semibold text-foreground">{audit.mustHaves.done} / {audit.mustHaves.total}</span></div>
          <Link to="/health" className="text-primary hover:underline">View report →</Link>
        </div>
      </CardContent>
    </Card>
  )
}

export function SiteHealthCard() {
  const { audit } = useAudit()
  if (!audit) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Site Health</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Checking…</CardContent>
      </Card>
    )
  }
  return <SiteHealthCardView audit={audit} />
}
