import type {
  AuditContext,
  AuditResult,
  CheckResult,
  HealthCategory,
  CategoryScore,
  Severity,
  RubricItem,
  HealthState
} from './types'
import { RUBRIC } from './rubric'
import { EVALUATORS, APPLIES_WHEN } from './checks'

const WEIGHT: Record<Severity, number> = {
  required: 10,
  avoid: 10,
  recommended: 3,
  optional: 1
}
const CATEGORIES: HealthCategory[] = [
  'foundations',
  'seo',
  'accessibility',
  'security',
  'well-known',
  'agent-readiness',
  'performance',
  'privacy',
  'resilience',
  'i18n'
]

function recordFor(item: RubricItem, health: HealthState) {
  return health.items[item.id] ?? health.sections[item.category]
}

function resolve(item: RubricItem, ctx: AuditContext): CheckResult {
  const rec = recordFor(item, ctx.health)
  const predicate = APPLIES_WHEN[item.id] ?? APPLIES_WHEN[item.category]
  const autoNa = predicate ? predicate(ctx) === false : false
  if (rec?.state === 'na' || autoNa) {
    return {
      id: item.id,
      status: 'na',
      owner: 'manual',
      naSource: autoNa ? 'auto' : 'manual',
      detail: autoNa ? naReason(item) : 'Marked not applicable to this site.'
    }
  }
  const ev = EVALUATORS[item.id]
  if (ev) return { id: item.id, ...ev(ctx) }
  if (rec?.state === 'attested') {
    return {
      id: item.id,
      status: 'pass',
      owner: 'manual',
      detail: rec.at
        ? `Self-verified on ${rec.at.slice(0, 10)}.`
        : 'Self-verified.'
    }
  }
  return {
    id: item.id,
    status: item.liveProbe ? 'pending' : 'unverified',
    owner: 'manual',
    attestable: true
  }
}

function naReason(item: RubricItem): string {
  if (item.category === 'i18n')
    return 'Not applicable — your site has a single content locale.'
  return 'Not applicable to this site.'
}

// `na` (not applicable) and `pending` (a live probe hasn't run yet) are both
// score-NEUTRAL — excluded from the denominator entirely. Counting an un-probed item
// as a non-pass would silently punish "not checked yet" and make the score dishonest
// (the whole point of #372/#373). Once a probe returns pass/fail the item counts.
const SCORE_NEUTRAL = new Set<CheckResult['status']>(['na', 'pending'])

const scoreOf = (
  items: { weight: number; status: CheckResult['status'] }[]
): { score: number; pass: number; total: number } => {
  const scored = items.filter((i) => !SCORE_NEUTRAL.has(i.status))
  const denom = scored.reduce((s, i) => s + i.weight, 0)
  const passW = scored
    .filter((i) => i.status === 'pass')
    .reduce((s, i) => s + i.weight, 0)
  return {
    score: denom === 0 ? 100 : Math.round((passW / denom) * 100),
    pass: scored.filter((i) => i.status === 'pass').length,
    total: scored.length
  }
}

/** Compute the score/band/breakdown from a set of check results. Single source of truth
 *  for scoring, shared by the initial audit and by `mergeProbe` (which re-scores after
 *  live-probe results flip items from `pending` to pass/fail). Unknown ids are ignored. */
export function scoreAudit(
  results: CheckResult[]
): Pick<AuditResult, 'score' | 'band' | 'byCategory' | 'mustHaves'> {
  const byId = new Map(results.map((r) => [r.id, r]))
  const statusOf = (id: string): CheckResult['status'] =>
    byId.get(id)?.status ?? 'unverified'
  const weighted = RUBRIC.map((i) => ({
    weight: WEIGHT[i.severity],
    status: statusOf(i.id)
  }))
  const { score } = scoreOf(weighted)
  const band: AuditResult['band'] =
    score >= 90 ? 'strong' : score >= 70 ? 'good' : 'needs-work'

  const byCategory: CategoryScore[] = CATEGORIES.filter((category) =>
    RUBRIC.some((i) => i.category === category)
  ).map((category) => {
    const items = RUBRIC.filter((i) => i.category === category).map((i) => ({
      weight: WEIGHT[i.severity],
      status: statusOf(i.id)
    }))
    const s = scoreOf(items)
    return { category, score: s.score, pass: s.pass, total: s.total }
  })

  const reqApplicable = RUBRIC.filter(
    (i) => i.severity === 'required' && statusOf(i.id) !== 'na'
  )
  const mustHaves = {
    done: reqApplicable.filter((i) => statusOf(i.id) === 'pass').length,
    total: reqApplicable.length
  }
  return { score, band, byCategory, mustHaves }
}

const isScanItem = (item: RubricItem): boolean => item.needsScan === true

/** The INSTANT-class results only (#593): config / settings / platform /
 *  attestation checks that touch NO content. Safe to run on every mount — pass
 *  `ctx.scan` as `null` and nothing reads the content facts. i18n applicability
 *  is scan-derived, so it stays applicable here until a scan runs. */
export function runInstantChecks(context: AuditContext): CheckResult[] {
  return RUBRIC.filter((item) => !isScanItem(item)).map((item) =>
    resolve(item, context)
  )
}

/** The SCAN-class results only: the per-entry content checks, resolved from the
 *  index-backed `context.scan`. Runs on explicit "Scan site" / "Re-scan", never
 *  on load. `context.scan === null` yields score-neutral `pending` rows. */
export function runScanChecks(context: AuditContext): CheckResult[] {
  return RUBRIC.filter(isScanItem).map((item) => resolve(item, context))
}

/** The full 156-item audit: instant + scan, merged and scored as one picture.
 *  When `context.scan` is `null` the scan rows are `pending` and score-neutral. */
export function runAudit(context: AuditContext): AuditResult {
  const results: CheckResult[] = RUBRIC.map((item) => resolve(item, context))
  return { results, ...scoreAudit(results) }
}
