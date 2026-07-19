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
 *  observed `{ finalUrl, status, headers }` here.
 *
 *  EVERY `liveProbe: true` rubric item must have an evaluator here and nothing else may
 *  (#659): `run-audit.ts` resolves an un-evaluated probe item to `pending`, which scoring
 *  excludes from the denominator permanently — so a `required` item stuck on `pending`
 *  inflates `mustHaves.total` with a row `mustHaves.done` can never reach. The
 *  {@link PROBE_ITEM_IDS} ↔ rubric equality test is the drift alarm (mirroring
 *  `SCAN_ITEM_IDS`/`needsScan`). */
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
  },
  {
    id: 'security.content-type-options',
    evaluate: ({ headers }) => {
      const value = headers.get('x-content-type-options')
      if (!value)
        return {
          status: 'fail',
          detail: 'No X-Content-Type-Options header.'
        }
      if (value.trim().toLowerCase() !== 'nosniff')
        return {
          status: 'fail',
          detail: `X-Content-Type-Options is "${value}", not "nosniff".`
        }
      return { status: 'pass', detail: 'X-Content-Type-Options: nosniff.' }
    }
  },
  {
    id: 'security.csp',
    evaluate: ({ headers }) => {
      const enforced = headers.get('content-security-policy')
      const reportOnly = headers.get('content-security-policy-report-only')
      if (!enforced)
        return {
          status: 'fail',
          detail: reportOnly
            ? 'Only Content-Security-Policy-Report-Only is sent — report-only is observe mode and blocks nothing. Promote the policy to the enforcing header.'
            : 'No Content-Security-Policy header.'
        }
      // A policy with no fetch directive (e.g. only `upgrade-insecure-requests`) restricts
      // no script or style source, so it does not do the job this item is checking for.
      const directives = enforced
        .split(';')
        .map((d) => d.trim().split(/\s+/)[0]?.toLowerCase())
        .filter((d): d is string => d !== undefined && d !== '')
      const hasFetchDirective = directives.some(
        (d) => d === 'default-src' || d.endsWith('-src')
      )
      if (!hasFetchDirective)
        return {
          status: 'fail',
          detail: `Content-Security-Policy has no fetch directive (found: ${directives.join(', ') || 'none'}). Add at least default-src or script-src.`
        }
      return {
        status: 'pass',
        detail: `Content-Security-Policy enforced (${directives.length} directive${directives.length === 1 ? '' : 's'}).`
      }
    }
  }
]

/** The rubric ids this module evaluates — the single source of truth the rubric's
 *  `liveProbe` flags are pinned to by test (#659), mirroring `SCAN_ITEM_IDS`/`needsScan`. */
export const PROBE_ITEM_IDS: readonly string[] = PROBE_EVALUATORS.map(
  (e) => e.id
)

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
