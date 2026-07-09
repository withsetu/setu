import type {
  AuditResult,
  CheckResult,
  ProbeInput,
  ProbeItemResult,
  ProbeReport
} from './types'
import { scoreAudit } from './run-audit'

/** Evaluate the header-derivable live-probe rubric items against one fetched response.
 *  Pure — the network fetch happens server-side (apps/api via safeFetch) and hands the
 *  observed `{ finalUrl, status, headers }` here. Each `liveProbe` rubric item gets an
 *  evaluator below; #373 ships the exemplar pair (https, hsts). CSP/nosniff (#200) and
 *  CWV (#78) add their evaluators to this same map. */
export function evaluateProbe(input: ProbeInput): ProbeItemResult[] {
  return PROBE_EVALUATORS.map(({ id, evaluate }) => ({
    id,
    ...evaluate(input)
  }))
}

type ProbeVerdict = { status: 'pass' | 'fail'; detail: string }

const PROBE_EVALUATORS: {
  id: string
  evaluate: (input: ProbeInput) => ProbeVerdict
}[] = [
  {
    id: 'security.https',
    evaluate: ({ finalUrl, status }) => {
      const https = finalUrl.startsWith('https://')
      const served = status >= 200 && status < 400
      if (https && served)
        return { status: 'pass', detail: 'Site served over HTTPS.' }
      if (!https)
        return {
          status: 'fail',
          detail: `Reached over ${new URL(finalUrl).protocol.replace(':', '')}, not HTTPS.`
        }
      return {
        status: 'fail',
        detail: `HTTPS responded with status ${status}.`
      }
    }
  },
  {
    id: 'security.hsts',
    evaluate: ({ headers }) => {
      const hsts = headers.get('strict-transport-security')
      if (!hsts)
        return {
          status: 'fail',
          detail: 'No Strict-Transport-Security header.'
        }
      const maxAge = /max-age=(\d+)/i.exec(hsts)
      if (!maxAge || Number(maxAge[1]) <= 0)
        return {
          status: 'fail',
          detail: `HSTS present but max-age is ${maxAge?.[1] ?? 'missing'}.`
        }
      return {
        status: 'pass',
        detail: `HSTS enabled (max-age ${maxAge[1]}).`
      }
    }
  }
]

/** Overlay a completed probe report onto a client audit: flip the matching items from
 *  `pending` to platform-owned pass/fail with a `probedAt` stamp, then re-score so the
 *  newly-verified items actually count. Items with no probe result are left untouched. */
export function mergeProbe(
  audit: AuditResult,
  report: ProbeReport
): AuditResult {
  const byId = new Map(report.results.map((r) => [r.id, r]))
  const results: CheckResult[] = audit.results.map((r) => {
    const probe = byId.get(r.id)
    if (!probe) return r
    return {
      ...r,
      status: probe.status,
      owner: 'platform',
      detail: probe.detail,
      probedAt: report.probedAt
    }
  })
  return { results, ...scoreAudit(results) }
}
