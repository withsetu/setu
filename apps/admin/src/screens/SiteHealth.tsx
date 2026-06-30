import type { AuditResult, CheckResult, HealthCategory, RubricItem } from '@setu/core'
import { RUBRIC } from '@setu/core'
import { PageHeader } from '../shell/PageHeader'
import { PageBody } from '../shell/PageBody'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { useAudit } from '../health/useAudit'

const ITEM = new Map<string, RubricItem>(RUBRIC.map((r) => [r.id, r]))
const SEV_LABEL: Record<RubricItem['severity'], string> = {
  required: 'Must',
  avoid: 'Must-not',
  recommended: 'Should',
  optional: 'Nice',
}

type Toggle = (kind: 'item' | 'section', id: string, state: 'attested' | 'na' | null) => void

function Row({ r, toggle }: { r: CheckResult; toggle: Toggle }) {
  const item = ITEM.get(r.id)
  if (!item) return null
  const icon = r.status === 'pass' ? '✓' : r.status === 'fail' || r.status === 'unverified' ? '✗' : '–'
  const canSkip = r.status === 'unverified' || r.status === 'pending' || (r.status === 'fail' && r.owner === 'platform')
  return (
    <div className="flex items-start gap-3 border-b border-border py-2.5">
      <span className={`mt-0.5 w-4 text-center text-sm ${r.status === 'fail' || r.status === 'unverified' ? 'text-destructive' : 'text-muted-foreground'}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{item.title}</span>
          <Badge variant="secondary">{SEV_LABEL[item.severity]}</Badge>
          <Badge variant="outline">{r.owner}</Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{r.detail ?? item.guidance}</p>
        {r.offenders && r.offenders.length > 0 && (
          <ul className="mt-1 list-disc list-inside text-xs text-muted-foreground space-y-0.5">
            {r.offenders.slice(0, 10).map((o) => <li key={o.ref}>{o.ref} — {o.note}</li>)}
          </ul>
        )}
        <div className="mt-1.5 flex items-center gap-4">
          {r.attestable && (
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={false}
                onCheckedChange={() => toggle('item', r.id, 'attested')}
                aria-label="I've verified this"
              />
              I've verified this
            </label>
          )}
          {r.status === 'na' && r.naSource === 'manual' && (
            <button className="text-xs text-primary hover:underline" onClick={() => toggle('item', r.id, null)}>Mark applicable</button>
          )}
          {canSkip && (
            <button className="text-xs text-muted-foreground hover:underline" onClick={() => toggle('item', r.id, 'na')}>Not applicable</button>
          )}
          <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Learn more</a>
        </div>
      </div>
    </div>
  )
}

function Section({ title, category, results, toggle }: { title: string; category?: HealthCategory; results: CheckResult[]; toggle: Toggle }) {
  if (results.length === 0) return null
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {category && (
          <button className="text-xs text-muted-foreground hover:underline" onClick={() => toggle('section', category, 'na')}>
            Skip section
          </button>
        )}
      </div>
      {results.map((r) => <Row key={r.id} r={r} toggle={toggle} />)}
    </section>
  )
}

export function SiteHealthView({ audit, toggle }: { audit: AuditResult; toggle: Toggle }) {
  const fixNow = audit.results.filter((r) => r.status === 'fail' && (r.owner === 'config' || r.owner === 'content'))
  const roadmap = audit.results.filter((r) => r.status === 'fail' && r.owner === 'platform')
  const toVerify = audit.results.filter((r) => r.status === 'unverified' || r.status === 'pending')
  const notApplicable = audit.results.filter((r) => r.status === 'na')
  const passing = audit.results.filter((r) => r.status === 'pass')
  const bandLabel = audit.band === 'strong' ? 'Strong' : audit.band === 'good' ? 'Good' : 'Needs work'
  const scoreColor = audit.band === 'needs-work' ? 'text-destructive' : 'text-foreground'
  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-end gap-4">
        <div className={`text-5xl font-bold tabular-nums ${scoreColor}`}>{audit.score}</div>
        <div className="pb-1 text-muted-foreground">
          <div className="font-medium">{bandLabel}</div>
          <div className="text-sm">Must-haves {audit.mustHaves.done} / {audit.mustHaves.total}</div>
        </div>
      </div>
      <p className="mb-1 text-xs text-muted-foreground">
        Audited against the{' '}
        <a className="underline" href="https://specification.website/" target="_blank" rel="noreferrer">
          Website Specification
        </a>
        .
      </p>
      <p className="mb-6 text-xs text-muted-foreground">
        "Not applicable" means it doesn't apply to your site — not "skip the work."
      </p>
      <Section title="Fix now (you)" results={fixNow} toggle={toggle} />
      <Section title="On Setu's roadmap" results={roadmap} toggle={toggle} />
      <Section title="To verify (you)" results={toVerify} toggle={toggle} />
      <Section title="Passing" results={passing} toggle={toggle} />
      <Section title="Not applicable" results={notApplicable} toggle={toggle} />
    </div>
  )
}

export function SiteHealth() {
  const { audit, toggle } = useAudit()
  return (
    <>
      <PageHeader title="Site Health" subtitle="How your site measures up to web best practices" />
      <PageBody>
        {audit ? (
          <SiteHealthView audit={audit} toggle={(k, i, s) => void toggle(k, i, s)} />
        ) : (
          <p className="text-sm text-muted-foreground">Checking…</p>
        )}
      </PageBody>
    </>
  )
}
