import type { AuditResult, CheckResult, RubricItem } from '@setu/core'
import { RUBRIC } from '@setu/core'
import { PageHeader } from '../shell/PageHeader'
import { PageBody } from '../shell/PageBody'
import { Badge } from '@/components/ui/badge'
import { useAudit } from '../health/useAudit'

const ITEM = new Map<string, RubricItem>(RUBRIC.map((r) => [r.id, r]))
const SEV_LABEL: Record<RubricItem['severity'], string> = {
  required: 'Must',
  avoid: 'Must-not',
  recommended: 'Should',
  optional: 'Nice',
}

function Row({ r }: { r: CheckResult }) {
  const item = ITEM.get(r.id)
  if (!item) return null
  const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '–'
  return (
    <div className="flex items-start gap-3 border-b border-border py-2.5">
      <span
        className={
          r.status === 'pass'
            ? 'mt-0.5 w-4 text-center text-sm text-muted-foreground'
            : r.status === 'fail'
              ? 'mt-0.5 w-4 text-center text-sm text-destructive'
              : 'mt-0.5 w-4 text-center text-sm text-muted-foreground'
        }
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{item.title}</span>
          <Badge variant="secondary">{SEV_LABEL[item.severity]}</Badge>
          <Badge variant="outline">{r.owner}</Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{r.detail ?? item.guidance}</p>
        {r.offenders && r.offenders.length > 0 && (
          <ul className="mt-1 list-disc list-inside text-xs text-muted-foreground space-y-0.5">
            {r.offenders.slice(0, 10).map((o) => (
              <li key={o.ref}>{o.ref} — {o.note}</li>
            ))}
          </ul>
        )}
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs text-primary hover:underline"
        >
          Learn more
        </a>
      </div>
    </div>
  )
}

function Section({ title, results }: { title: string; results: CheckResult[] }) {
  if (results.length === 0) return null
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {results.map((r) => (
        <Row key={r.id} r={r} />
      ))}
    </section>
  )
}

export function SiteHealthView({ audit }: { audit: AuditResult }) {
  const fixNow = audit.results.filter(
    (r) => r.status === 'fail' && (r.owner === 'config' || r.owner === 'content'),
  )
  const roadmap = audit.results.filter((r) => r.status === 'fail' && r.owner === 'platform')
  const manual = audit.results.filter((r) => r.status === 'pending' || r.status === 'manual')
  const passing = audit.results.filter((r) => r.status === 'pass')

  const bandLabel = audit.band === 'strong' ? 'Strong' : audit.band === 'good' ? 'Good' : 'Needs work'
  const scoreColor =
    audit.band === 'strong'
      ? 'text-foreground'
      : audit.band === 'good'
        ? 'text-foreground'
        : 'text-destructive'

  return (
    <div className="max-w-3xl">
      {/* Score card */}
      <div className="mb-6 flex items-end gap-4">
        <div className={`text-5xl font-bold tabular-nums ${scoreColor}`}>{audit.score}</div>
        <div className="pb-1 text-muted-foreground">
          <div className="font-medium">{bandLabel}</div>
          <div className="text-sm">
            Must-haves {audit.mustHaves.done} / {audit.mustHaves.total}
          </div>
        </div>
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        Audited against the{' '}
        <a
          className="underline"
          href="https://specification.website/"
          target="_blank"
          rel="noreferrer"
        >
          Website Specification
        </a>
        .
      </p>

      <Section title="Fix now (you)" results={fixNow} />
      <Section title="On Setu's roadmap" results={roadmap} />
      <Section title="Manual / live checks" results={manual} />
      <Section title="Passing" results={passing} />
    </div>
  )
}

export function SiteHealth() {
  const { audit } = useAudit()
  return (
    <>
      <PageHeader
        title="Site Health"
        subtitle="How your site measures up to web best practices"
      />
      <PageBody>
        {audit ? (
          <SiteHealthView audit={audit} />
        ) : (
          <p className="text-sm text-muted-foreground">Checking…</p>
        )}
      </PageBody>
    </>
  )
}
