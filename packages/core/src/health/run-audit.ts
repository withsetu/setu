import type { AuditContext, AuditResult, CheckResult, HealthCategory, CategoryScore, Severity } from './types'
import { RUBRIC } from './rubric'
import { EVALUATORS } from './checks'

const WEIGHT: Record<Severity, number> = { required: 10, avoid: 10, recommended: 3, optional: 1 }
const CATEGORIES: HealthCategory[] = ['foundations','seo','accessibility','security','well-known','agent-readiness','performance','privacy','resilience','i18n']

const scoreOf = (items: { weight: number; status: CheckResult['status'] }[]): { score: number; pass: number; total: number } => {
  const scored = items.filter((i) => i.status === 'pass' || i.status === 'fail')
  const denom = scored.reduce((s, i) => s + i.weight, 0)
  const passW = scored.filter((i) => i.status === 'pass').reduce((s, i) => s + i.weight, 0)
  return { score: denom === 0 ? 100 : Math.round((passW / denom) * 100), pass: scored.filter((i) => i.status === 'pass').length, total: scored.length }
}

export function runAudit(context: AuditContext): AuditResult {
  const results: CheckResult[] = RUBRIC.map((item) => {
    const ev = EVALUATORS[item.id]
    if (ev) return { id: item.id, ...ev(context) }
    return { id: item.id, status: item.liveProbe ? 'pending' : 'manual', owner: 'manual' }
  })
  const byId = new Map(results.map((r) => [r.id, r]))
  const weighted = RUBRIC.map((i) => ({ weight: WEIGHT[i.severity], status: byId.get(i.id)!.status }))
  const { score } = scoreOf(weighted)
  const band: AuditResult['band'] = score >= 90 ? 'strong' : score >= 70 ? 'good' : 'needs-work'

  const byCategory: CategoryScore[] = CATEGORIES.map((category) => {
    const items = RUBRIC.filter((i) => i.category === category).map((i) => ({ weight: WEIGHT[i.severity], status: byId.get(i.id)!.status }))
    const s = scoreOf(items)
    return { category, score: s.score, pass: s.pass, total: s.total }
  }).filter((c) => RUBRIC.some((i) => i.category === c.category))

  const requiredScored = RUBRIC.filter((i) => i.severity === 'required' && ['pass','fail'].includes(byId.get(i.id)!.status))
  const mustHaves = { done: requiredScored.filter((i) => byId.get(i.id)!.status === 'pass').length, total: requiredScored.length }

  return { results, score, band, byCategory, mustHaves }
}
