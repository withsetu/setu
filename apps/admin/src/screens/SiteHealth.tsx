import type {
  AuditResult,
  CheckResult,
  HealthCategory,
  HealthState,
  RubricItem
} from '@setu/core'
import { RUBRIC } from '@setu/core'
import { PageHeader } from '../shell/PageHeader'
import { PageBody } from '../shell/PageBody'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { relativeTime } from '@/lib/format'
import {
  useAudit,
  probeUnavailableMessage,
  type ProbeState,
  type ScanState
} from '../health/useAudit'

const ITEM = new Map<string, RubricItem>(RUBRIC.map((r) => [r.id, r]))
const SEV_LABEL: Record<RubricItem['severity'], string> = {
  required: 'Must',
  avoid: 'Must-not',
  recommended: 'Should',
  optional: 'Nice'
}

// Derive unique categories that appear in the rubric, in first-appearance order
const RUBRIC_CATEGORIES: HealthCategory[] = Array.from(
  new Map(RUBRIC.map((r) => [r.category, r.category])).values()
)

const CATEGORY_LABEL: Record<HealthCategory, string> = {
  foundations: 'Foundations',
  seo: 'SEO',
  accessibility: 'Accessibility',
  security: 'Security',
  'well-known': 'Well-known',
  'agent-readiness': 'Agent readiness',
  performance: 'Performance',
  privacy: 'Privacy',
  resilience: 'Resilience',
  i18n: 'Internationalisation'
}

type Toggle = (
  kind: 'item' | 'section',
  id: string,
  state: 'attested' | 'na' | null
) => void

function Row({ r, toggle }: { r: CheckResult; toggle: Toggle }) {
  const item = ITEM.get(r.id)
  if (!item) return null
  const icon =
    r.status === 'pass'
      ? '✓'
      : r.status === 'fail' || r.status === 'unverified'
        ? '✗'
        : '–'
  const canSkip =
    r.status === 'unverified' ||
    r.status === 'pending' ||
    (r.status === 'fail' && r.owner === 'platform')
  return (
    <div className="flex items-start gap-3 border-b border-border py-2.5">
      <span
        className={`mt-0.5 w-4 text-center text-sm ${r.status === 'fail' || r.status === 'unverified' ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{item.title}</span>
          <Badge variant="secondary">{SEV_LABEL[item.severity]}</Badge>
          <Badge variant="outline">{r.owner}</Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {r.detail ?? item.guidance}
        </p>
        {r.offenders && r.offenders.length > 0 && (
          <ul className="mt-1 list-disc list-inside text-xs text-muted-foreground space-y-0.5">
            {r.offenders.slice(0, 10).map((o) => (
              <li key={o.ref}>
                {o.ref} — {o.note}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1.5 flex items-center gap-4">
          {r.attestable && (
            <label className="flex items-center gap-1.5 text-xs">
              {/* An attestable item is by definition not-yet-passing: once the admin attests it,
                  the engine emits `pass` and the row leaves the "To verify" group entirely.
                  So checked=false is correct — attesting is a one-way action, not a toggle. */}
              <Checkbox
                checked={false}
                onCheckedChange={() => toggle('item', r.id, 'attested')}
                aria-label="I've verified this"
              />
              I've verified this
            </label>
          )}
          {r.status === 'na' && r.naSource === 'manual' && (
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => toggle('item', r.id, null)}
            >
              Mark applicable
            </button>
          )}
          {canSkip && (
            <button
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => toggle('item', r.id, 'na')}
            >
              Not applicable
            </button>
          )}
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Learn more
          </a>
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  results,
  toggle
}: {
  title: string
  results: CheckResult[]
  toggle: Toggle
}) {
  if (results.length === 0) return null
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      </div>
      {results.map((r) => (
        <Row key={r.id} r={r} toggle={toggle} />
      ))}
    </section>
  )
}

function SectionApplicabilityPanel({
  health,
  toggle
}: {
  health: HealthState
  toggle: Toggle
}) {
  return (
    <section className="mb-8 rounded-lg border border-border p-4">
      <h2 className="mb-1 text-sm font-semibold">
        Sections that apply to your site
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Uncheck a section that doesn't apply to your site — its items won't
        count toward your score.
      </p>
      <div className="space-y-2">
        {RUBRIC_CATEGORIES.map((cat) => {
          const skipped = health.sections[cat]?.state === 'na'
          return (
            <label
              key={cat}
              className="flex items-center gap-2.5 text-sm cursor-pointer"
            >
              <Checkbox
                checked={!skipped}
                onCheckedChange={(checked) =>
                  toggle('section', cat, checked ? null : 'na')
                }
                aria-label={CATEGORY_LABEL[cat]}
              />
              <span>{CATEGORY_LABEL[cat]}</span>
            </label>
          )
        })}
      </div>
    </section>
  )
}

/** The content-scan control (#593). Like Yoast/Screaming Frog you RUN a crawl —
 *  the 5 per-page content checks read this cached, index-backed scan instead of
 *  re-walking every published page on every visit. Mirrors the Site & Deploy
 *  card's "last done · time ago + action" shape. */
function ScanPanel({
  scan,
  scanState,
  scannedAt
}: {
  scan: () => void
  scanState: ScanState
  scannedAt: string | null
}) {
  const scanning = scanState.status === 'scanning'
  return (
    <section className="mb-6 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Content checks</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {scannedAt === null
              ? 'Your pages haven’t been scanned yet — run a scan to check titles, alt text and headings across every published page.'
              : `Last scanned ${relativeTime(Date.parse(scannedAt))}.`}
          </p>
          {scanState.status === 'error' && (
            <p className="mt-0.5 text-xs text-destructive">
              Couldn’t run the scan. Check your connection and try again.
            </p>
          )}
        </div>
        <Button onClick={scan} disabled={scanning} size="sm">
          {scanning
            ? 'Scanning…'
            : scannedAt === null
              ? 'Scan site'
              : 'Re-scan'}
        </Button>
      </div>
    </section>
  )
}

/** The live-probe control: fetches the deployed site and turns HTTPS/HSTS (and, as the
 *  harness grows, CSP/nosniff/CWV) from "not checked" into real pass/fail. Honest by
 *  design — when there's nothing reachable to probe it says so, never a false pass. */
function ProbePanel({
  probe,
  probeState
}: {
  probe: () => void
  probeState: ProbeState
}) {
  const probing = probeState.status === 'probing'
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button onClick={probe} disabled={probing} variant="outline" size="sm">
        {probing ? 'Checking…' : 'Check live site'}
      </Button>
      {probeState.status === 'done' && (
        <span className="text-sm text-muted-foreground">
          Live checks ran {relativeTime(Date.parse(probeState.probedAt))}.
        </span>
      )}
      {probeState.status === 'unavailable' && (
        <span className="text-sm text-destructive">
          Probe unavailable —{' '}
          {probeUnavailableMessage(probeState.reason, probeState.detail)}
        </span>
      )}
      {probeState.status === 'idle' && (
        <span className="text-sm text-muted-foreground">
          Run live checks against your deployed site (HTTPS, HSTS…).
        </span>
      )}
    </div>
  )
}

export function SiteHealthView({
  audit,
  toggle,
  health,
  probe,
  probeState,
  scan = () => {},
  scanState = { status: 'idle' },
  scannedAt = null
}: {
  audit: AuditResult
  toggle: Toggle
  health: HealthState
  probe: () => void
  probeState: ProbeState
  scan?: () => void
  scanState?: ScanState
  scannedAt?: string | null
}) {
  const fixNow = audit.results.filter(
    (r) =>
      r.status === 'fail' && (r.owner === 'config' || r.owner === 'content')
  )
  const roadmap = audit.results.filter(
    (r) => r.status === 'fail' && r.owner === 'platform'
  )
  const toVerify = audit.results.filter(
    (r) => r.status === 'unverified' || r.status === 'pending'
  )
  const notApplicable = audit.results.filter((r) => r.status === 'na')
  const passing = audit.results.filter((r) => r.status === 'pass')
  const bandLabel =
    audit.band === 'strong'
      ? 'Strong'
      : audit.band === 'good'
        ? 'Good'
        : 'Needs work'
  const scoreColor =
    audit.band === 'needs-work' ? 'text-destructive' : 'text-foreground'
  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-end gap-4">
        <div className={`text-5xl font-bold tabular-nums ${scoreColor}`}>
          {audit.score}
        </div>
        <div className="pb-1 text-muted-foreground">
          <div className="font-medium">{bandLabel}</div>
          <div className="text-sm">
            Must-haves {audit.mustHaves.done} / {audit.mustHaves.total}
          </div>
        </div>
      </div>
      <p className="mb-1 text-xs text-muted-foreground">
        Audited against the{' '}
        <a
          className="underline"
          href="https://specification.website/"
          target="_blank"
          rel="noreferrer"
        >
          Website Specification
        </a>
        . Checklist content &copy;{' '}
        <a
          className="underline"
          href="https://specification.website/"
          target="_blank"
          rel="noreferrer"
        >
          specification.website
        </a>
        , licensed{' '}
        <a
          className="underline"
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noreferrer"
        >
          CC BY 4.0
        </a>
        .
      </p>
      <p className="mb-6 text-xs text-muted-foreground">
        "Not applicable" means it doesn't apply to your site — not "skip the
        work."
      </p>
      <ScanPanel scan={scan} scanState={scanState} scannedAt={scannedAt} />
      <ProbePanel probe={probe} probeState={probeState} />
      <SectionApplicabilityPanel health={health} toggle={toggle} />
      <Section title="Fix now (you)" results={fixNow} toggle={toggle} />
      <Section title="On Setu's roadmap" results={roadmap} toggle={toggle} />
      <Section title="To verify (you)" results={toVerify} toggle={toggle} />
      <Section title="Passing" results={passing} toggle={toggle} />
      <Section title="Not applicable" results={notApplicable} toggle={toggle} />
    </div>
  )
}

export function SiteHealth() {
  const {
    audit,
    toggle,
    health,
    probe,
    probeState,
    scan,
    scanState,
    scannedAt
  } = useAudit()
  return (
    <>
      <PageHeader
        title="Site Health"
        subtitle="How your site measures up to web best practices"
      />
      <PageBody>
        {audit ? (
          <SiteHealthView
            audit={audit}
            toggle={(k, i, s) => void toggle(k, i, s)}
            health={health}
            probe={() => void probe()}
            probeState={probeState}
            scan={() => void scan()}
            scanState={scanState}
            scannedAt={scannedAt}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Checking…</p>
        )}
      </PageBody>
    </>
  )
}
