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

const scoreOf = (
  items: { weight: number; status: CheckResult['status'] }[]
): { score: number; pass: number; total: number } => {
  const scored = items.filter((i) => i.status !== 'na') // na excluded; everything else counts
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

export function runAudit(context: AuditContext): AuditResult {
  const results: CheckResult[] = RUBRIC.map((item) => resolve(item, context))
  const byId = new Map(results.map((r) => [r.id, r]))
  const weighted = RUBRIC.map((i) => ({
    weight: WEIGHT[i.severity],
    status: byId.get(i.id)!.status
  }))
  const { score } = scoreOf(weighted)
  const band: AuditResult['band'] =
    score >= 90 ? 'strong' : score >= 70 ? 'good' : 'needs-work'

  const byCategory: CategoryScore[] = CATEGORIES.filter((category) =>
    RUBRIC.some((i) => i.category === category)
  ).map((category) => {
    const items = RUBRIC.filter((i) => i.category === category).map((i) => ({
      weight: WEIGHT[i.severity],
      status: byId.get(i.id)!.status
    }))
    const s = scoreOf(items)
    return { category, score: s.score, pass: s.pass, total: s.total }
  })

  const reqApplicable = RUBRIC.filter(
    (i) => i.severity === 'required' && byId.get(i.id)!.status !== 'na'
  )
  const mustHaves = {
    done: reqApplicable.filter((i) => byId.get(i.id)!.status === 'pass').length,
    total: reqApplicable.length
  }

  return { results, score, band, byCategory, mustHaves }
}
