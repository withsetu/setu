# Site Health v2 — Attestation, Applicability & Full Rubric — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Site Health scorecard honest and tailorable — Git-backed manual attestation (ticked = pass), applicability/N-A (auto i18n + manual toggle, excluded from score), and a full-checklist rubric.

**Architecture:** Extend v1's pure `runAudit` with a **resolution order** (N/A → auto-evaluator → attested → unverified/pending) over a new `health: HealthState` input; persist attestation/applicability in a Git-backed `site-health.json`; the `/health` screen gains attest checkboxes + N/A toggles that commit-and-recompute live; a maintainer script grows the rubric from the spec's MCP.

**Tech Stack:** TypeScript (strict), `@markdoc/markdoc`, React 19 + shadcn/ui, Vitest, the existing `GitPort`/settings-store. Builds on v1 ([health module](../../../packages/core/src/health/)).

## Global Constraints

- **Depends on PR #61 (v1).** This branch is off `site-health`; **rebase onto `main` after #61 merges** before implementing. No new runtime deps.
- TS strict, `verbatimModuleSyntax` (`import type`), `isolatedModules`.
- **Git storage** for attestation/applicability — a committed `site-health.json` at the content root (sibling of `settings.json`), written via `git.commitFile({ ..., author: OWNER_AUTHOR })`. No DB.
- **`CheckStatus` becomes `'pass' | 'fail' | 'unverified' | 'pending' | 'na'`** (v1's `'manual'` is renamed to `'unverified'`).
- **Resolution order per item:** (1) `na` if admin set the item/section to `na` **or** an `appliesWhen` predicate is `false`; (2) else auto-evaluator → `pass`/`fail` (auto wins, attestation ignored); (3) else attested → `pass`; (4) else `pending` if `liveProbe` else `unverified`.
- **Scoring:** `pass` weight ÷ (weight of all non-`na`), so `fail`/`unverified`/`pending` all count as not-passed; **`na` excluded**. Weights `required/avoid=10, recommended=3, optional=1`. Bands ≥90 strong / 70–89 good / <70 needs-work. `mustHaves` counts `required` non-`na`.
- **Auto-applicability:** category-level predicates (v2 ships i18n: applies iff content has >1 locale).
- **N/A copy:** "N/A means this doesn't apply to your site — not 'skip the work.'"
- TDD; conventional commits ending `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Core — health-state types + parse/merge

**Files:**
- Modify: `packages/core/src/health/types.ts`
- Create: `packages/core/src/health/health-state.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/health-state.test.ts`

**Interfaces:**
- Produces: `AttestationRecord`, `HealthState`; updated `CheckStatus` (`+ 'unverified' | 'na'`, `- 'manual'`); `CheckResult` gains `attestable?: boolean` + `naSource?: 'auto' | 'manual'`; `AuditContext` gains `health: HealthState`; `parseHealthState(raw): HealthState`; `setHealthRecord(state, kind, id, record): HealthState`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/health-state.test.ts
import { describe, it, expect } from 'vitest'
import { parseHealthState, setHealthRecord } from '../src/index'

describe('parseHealthState', () => {
  it('defaults to empty on missing/malformed input (never throws)', () => {
    expect(parseHealthState(undefined)).toEqual({ items: {}, sections: {} })
    expect(parseHealthState('not an object')).toEqual({ items: {}, sections: {} })
    expect(parseHealthState({ items: 5 })).toEqual({ items: {}, sections: {} })
  })
  it('keeps well-formed records and drops malformed ones', () => {
    const s = parseHealthState({ items: { 'a.b': { state: 'attested', at: '2026-01-01', by: 'Local' }, bad: { state: 'nope' } }, sections: { i18n: { state: 'na', at: '2026-01-01', by: 'Local' } } })
    expect(s.items['a.b']?.state).toBe('attested')
    expect(s.items.bad).toBeUndefined()
    expect(s.sections.i18n?.state).toBe('na')
  })
})

describe('setHealthRecord', () => {
  it('sets and clears item records immutably', () => {
    const a = setHealthRecord({ items: {}, sections: {} }, 'item', 'x', { state: 'na', at: '2026-01-01', by: 'Local' })
    expect(a.items.x?.state).toBe('na')
    const b = setHealthRecord(a, 'item', 'x', null)
    expect(b.items.x).toBeUndefined()
    expect(a.items.x?.state).toBe('na') // original untouched
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- health-state`
Expected: FAIL — module not found.

- [ ] **Step 3: Update `packages/core/src/health/types.ts`**

Change `CheckStatus`, extend `CheckResult` + `AuditContext`, add the new types:
```ts
export type CheckStatus = 'pass' | 'fail' | 'unverified' | 'pending' | 'na'
```
```ts
export interface CheckResult {
  id: string
  status: CheckStatus
  owner: Owner
  detail?: string
  offenders?: { ref: string; note: string }[]
  /** Non-auto item the admin can attest ("I've verified this"). */
  attestable?: boolean
  /** Why an item is N/A: auto-detected vs admin-set. */
  naSource?: 'auto' | 'manual'
}

export interface AttestationRecord { state: 'attested' | 'na'; at: string; by: string }
export interface HealthState {
  items: Record<string, AttestationRecord>
  sections: Record<string, AttestationRecord> // keyed by HealthCategory
}
```
And add `health: HealthState` to `AuditContext`:
```ts
export interface AuditContext {
  settings: { general: { title: string; description: string }; reading: { homepage: string; searchEngineVisible: boolean; feed: { enabled: boolean } } }
  entries: AuditEntry[]
  capabilities: SiteCapabilities
  health: HealthState
}
```

- [ ] **Step 4: Create `packages/core/src/health/health-state.ts`**

```ts
import type { AttestationRecord, HealthState } from './types'

const isRecord = (v: unknown): v is AttestationRecord =>
  typeof v === 'object' && v !== null &&
  ((v as { state?: unknown }).state === 'attested' || (v as { state?: unknown }).state === 'na')

function parseBucket(raw: unknown): Record<string, AttestationRecord> {
  const out: Record<string, AttestationRecord> = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isRecord(v)) out[k] = { state: v.state, at: typeof v.at === 'string' ? v.at : '', by: typeof v.by === 'string' ? v.by : '' }
  }
  return out
}

/** Parse the Git-backed health state. Never throws; malformed → empty. */
export function parseHealthState(raw: unknown): HealthState {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as { items?: unknown; sections?: unknown }
  return { items: parseBucket(obj.items), sections: parseBucket(obj.sections) }
}

/** Immutably set (or clear, when record is null) one item/section record. */
export function setHealthRecord(state: HealthState, kind: 'item' | 'section', id: string, record: AttestationRecord | null): HealthState {
  const bucketKey = kind === 'item' ? 'items' : 'sections'
  const bucket = { ...state[bucketKey] }
  if (record === null) delete bucket[id]
  else bucket[id] = record
  return { ...state, [bucketKey]: bucket }
}
```

- [ ] **Step 5: Export from `packages/core/src/index.ts`**

Add to the health export block / after it:
```ts
export type { AttestationRecord, HealthState } from './health/types'
export { parseHealthState, setHealthRecord } from './health/health-state'
```

- [ ] **Step 6: Run test + commit**

Run: `pnpm --filter @setu/core test -- health-state` → PASS. `pnpm --filter @setu/core typecheck` (expect errors in run-audit.ts / checks.ts from the `CheckStatus` change + missing `health` — fixed in Task 2; if the typecheck must be green to commit, do Task 2 before committing, otherwise commit types+state now and note the transient break). Prefer: **commit Task 1 together with Task 2** if your repo blocks on a red typecheck — they form one type-coherent change. If committing separately is fine:
```bash
git add packages/core/src/health/types.ts packages/core/src/health/health-state.ts packages/core/src/index.ts packages/core/test/health-state.test.ts
git commit -m "feat(core): health-state types + parse/merge (attestation/applicability)"
```

---

## Task 2: Core — resolution order, applicability & scoring

**Files:**
- Modify: `packages/core/src/health/checks.ts` (add `APPLIES_WHEN` + `localeCount`)
- Modify: `packages/core/src/health/run-audit.ts` (resolution order + scoring)
- Modify: `packages/core/src/index.ts` (export `APPLIES_WHEN`)
- Modify: `packages/core/test/health-audit.test.ts` (update for new statuses + resolution order)

**Interfaces:**
- Consumes: `HealthState`, updated types (Task 1); `EVALUATORS`, `RUBRIC`.
- Produces: `APPLIES_WHEN: Record<string, (ctx: AuditContext) => boolean>`; `runAudit` over the new context.

- [ ] **Step 1: Update the audit test (TDD — assert the new behavior)**

Replace the `ctx` helper + the status assertions in `packages/core/test/health-audit.test.ts`. Add `health` to the context and cover the resolution order:
```ts
const ctx = (over: Partial<AuditContext> = {}): AuditContext => ({
  settings: { general: { title: 'T', description: 'D' }, reading: { homepage: 'page/en/home', searchEngineVisible: true, feed: { enabled: false } } },
  entries: [{ id: 'page/en/home', data: { title: 'Home' }, body: 'Hello' }],
  capabilities: SITE_CAPABILITIES,
  health: { items: {}, sections: {} },
  ...over,
})

it('non-auto manual item is unverified (not excluded) and attestable', () => {
  const a = runAudit(ctx())
  const p = a.results.find((r) => r.id === 'privacy.policy')!
  expect(p.status).toBe('unverified')
  expect(p.attestable).toBe(true)
})
it('an attestation turns an unverified item into a pass', () => {
  const a = runAudit(ctx({ health: { items: { 'privacy.policy': { state: 'attested', at: '2026-01-01', by: 'Local' } }, sections: {} } }))
  expect(a.results.find((r) => r.id === 'privacy.policy')?.status).toBe('pass')
})
it('an auto-evaluator supersedes an attestation for the same id', () => {
  const a = runAudit(ctx({ health: { items: { 'foundations.title': { state: 'attested', at: '2026-01-01', by: 'Local' } }, sections: {} } }))
  // foundations.title has a config evaluator → still evaluated, attestation ignored
  expect(a.results.find((r) => r.id === 'foundations.title')?.status).toBe('pass') // (passes anyway, but via the evaluator)
})
it('manual na excludes an item from the score', () => {
  const base = runAudit(ctx())
  const na = runAudit(ctx({ health: { items: { 'seo.sitemap': { state: 'na', at: '2026-01-01', by: 'Local' } }, sections: {} } }))
  expect(na.results.find((r) => r.id === 'seo.sitemap')?.status).toBe('na')
  expect(na.results.find((r) => r.id === 'seo.sitemap')?.naSource).toBe('manual')
  expect(na.score).toBeGreaterThan(base.score) // dropping a failing must-have from the denominator raises the score
})
it('i18n auto-N/As on a single-locale site and applies with a 2nd locale', () => {
  const single = runAudit(ctx())
  expect(single.results.find((r) => r.id === 'i18n.hreflang')?.status).toBe('na')
  expect(single.results.find((r) => r.id === 'i18n.hreflang')?.naSource).toBe('auto')
  const multi = runAudit(ctx({ entries: [{ id: 'page/en/home', data: { title: 'H' }, body: '' }, { id: 'post/fr/x', data: { title: 'X' }, body: '' }] }))
  expect(multi.results.find((r) => r.id === 'i18n.hreflang')?.status).not.toBe('na')
})
it('section na excludes every item in that category', () => {
  const a = runAudit(ctx({ health: { items: {}, sections: { accessibility: { state: 'na', at: '2026-01-01', by: 'Local' } } } }))
  expect(a.results.filter((r) => r.id.startsWith('accessibility.')).every((r) => r.status === 'na')).toBe(true)
})
```
(Keep the existing pass/fail/pending assertions, but change any `status === 'manual'` expectation to `'unverified'`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @setu/core test -- health-audit`
Expected: FAIL (status `manual` vs `unverified`; no `health` handling; no `appliesWhen`).

- [ ] **Step 3: Add `APPLIES_WHEN` + `localeCount` to `packages/core/src/health/checks.ts`**

At the end of the file:
```ts
/** Locale = the 2nd id segment (collection/LOCALE/slug). */
function localeCount(ctx: AuditContext): number {
  return new Set(ctx.entries.map((e) => e.id.split('/')[1]).filter(Boolean)).size
}

/** Auto-applicability predicates, keyed by item id OR category. False → the item is N/A (auto). */
export const APPLIES_WHEN: Record<string, (ctx: AuditContext) => boolean> = {
  // Internationalisation only matters once the site has more than one content locale.
  i18n: (ctx) => localeCount(ctx) > 1,
}
```

- [ ] **Step 4: Rewrite `packages/core/src/health/run-audit.ts`**

```ts
import type { AuditContext, AuditResult, CheckResult, HealthCategory, CategoryScore, Severity, RubricItem, HealthState } from './types'
import { RUBRIC } from './rubric'
import { EVALUATORS, APPLIES_WHEN } from './checks'

const WEIGHT: Record<Severity, number> = { required: 10, avoid: 10, recommended: 3, optional: 1 }
const CATEGORIES: HealthCategory[] = ['foundations','seo','accessibility','security','well-known','agent-readiness','performance','privacy','resilience','i18n']

function recordFor(item: RubricItem, health: HealthState) {
  return health.items[item.id] ?? health.sections[item.category]
}

function resolve(item: RubricItem, ctx: AuditContext): CheckResult {
  const rec = recordFor(item, ctx.health)
  const predicate = APPLIES_WHEN[item.id] ?? APPLIES_WHEN[item.category]
  const autoNa = predicate ? predicate(ctx) === false : false
  if (rec?.state === 'na' || autoNa) {
    return {
      id: item.id, status: 'na', owner: 'manual', naSource: autoNa ? 'auto' : 'manual',
      detail: autoNa ? naReason(item, ctx) : 'Marked not applicable to this site.',
    }
  }
  const ev = EVALUATORS[item.id]
  if (ev) return { id: item.id, ...ev(ctx) }
  if (rec?.state === 'attested') {
    return { id: item.id, status: 'pass', owner: 'manual', detail: rec.at ? `Self-verified on ${rec.at.slice(0, 10)}.` : 'Self-verified.' }
  }
  return { id: item.id, status: item.liveProbe ? 'pending' : 'unverified', owner: 'manual', attestable: true }
}

function naReason(item: RubricItem, ctx: AuditContext): string {
  if (item.category === 'i18n') return 'Not applicable — your site has a single content locale.'
  return 'Not applicable to this site.'
}

const scoreOf = (items: { weight: number; status: CheckResult['status'] }[]): { score: number; pass: number; total: number } => {
  const scored = items.filter((i) => i.status !== 'na')          // na excluded; everything else counts
  const denom = scored.reduce((s, i) => s + i.weight, 0)
  const passW = scored.filter((i) => i.status === 'pass').reduce((s, i) => s + i.weight, 0)
  return { score: denom === 0 ? 100 : Math.round((passW / denom) * 100), pass: scored.filter((i) => i.status === 'pass').length, total: scored.length }
}

export function runAudit(context: AuditContext): AuditResult {
  const results: CheckResult[] = RUBRIC.map((item) => resolve(item, context))
  const byId = new Map(results.map((r) => [r.id, r]))
  const weighted = RUBRIC.map((i) => ({ weight: WEIGHT[i.severity], status: byId.get(i.id)!.status }))
  const { score } = scoreOf(weighted)
  const band: AuditResult['band'] = score >= 90 ? 'strong' : score >= 70 ? 'good' : 'needs-work'

  const byCategory: CategoryScore[] = CATEGORIES.filter((category) => RUBRIC.some((i) => i.category === category)).map((category) => {
    const items = RUBRIC.filter((i) => i.category === category).map((i) => ({ weight: WEIGHT[i.severity], status: byId.get(i.id)!.status }))
    const s = scoreOf(items)
    return { category, score: s.score, pass: s.pass, total: s.total }
  })

  const reqApplicable = RUBRIC.filter((i) => i.severity === 'required' && byId.get(i.id)!.status !== 'na')
  const mustHaves = { done: reqApplicable.filter((i) => byId.get(i.id)!.status === 'pass').length, total: reqApplicable.length }

  return { results, score, band, byCategory, mustHaves }
}
```

- [ ] **Step 5: Export `APPLIES_WHEN`**

In `packages/core/src/index.ts`, add `APPLIES_WHEN` to the `./health/checks` export:
```ts
export { EVALUATORS, APPLIES_WHEN } from './health/checks'
```

- [ ] **Step 6: Run tests + typecheck + commit**

Run: `pnpm --filter @setu/core test -- health` (health-state + health-audit + health-rubric) → PASS. `pnpm --filter @setu/core test` (full) and `pnpm --filter @setu/core typecheck` → green.
```bash
git add packages/core/src/health/checks.ts packages/core/src/health/run-audit.ts packages/core/src/index.ts packages/core/test/health-audit.test.ts
git commit -m "feat(core): site-health resolution order — attestation, applicability, na scoring"
```

---

## Task 3: Admin — health-state IO + useAudit wiring

**Files:**
- Create: `apps/admin/src/health/health-state.ts`
- Modify: `apps/admin/src/health/useAudit.ts`
- Test: `apps/admin/test/health-state-io.test.tsx`

**Interfaces:**
- Consumes: `parseHealthState`, `setHealthRecord`, `runAudit` (core); `useServices().git` + `OWNER_AUTHOR`; `useSettings`.
- Produces: `loadHealthState(git): Promise<HealthState>`; `writeHealthRecord(git, kind, id, record): Promise<void>`; `useAudit(): { audit, toggle }`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/test/health-state-io.test.tsx
import { describe, it, expect } from 'vitest'
import { createMemoryGitPort } from '@setu/git-memory'
import { loadHealthState, writeHealthRecord } from '../src/health/health-state'

describe('health-state IO', () => {
  it('writes a record and reads it back', async () => {
    const git = createMemoryGitPort([])
    await writeHealthRecord(git, 'item', 'privacy.policy', { state: 'attested', at: '2026-01-01', by: 'Local' })
    const state = await loadHealthState(git)
    expect(state.items['privacy.policy']?.state).toBe('attested')
  })
  it('preserves other records when updating one', async () => {
    const git = createMemoryGitPort([])
    await writeHealthRecord(git, 'item', 'a', { state: 'na', at: '2026-01-01', by: 'Local' })
    await writeHealthRecord(git, 'section', 'i18n', { state: 'na', at: '2026-01-01', by: 'Local' })
    await writeHealthRecord(git, 'item', 'a', null) // clear
    const state = await loadHealthState(git)
    expect(state.items.a).toBeUndefined()
    expect(state.sections.i18n?.state).toBe('na')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- health-state-io`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/admin/src/health/health-state.ts`**

```ts
import { parseHealthState, setHealthRecord, type HealthState, type AttestationRecord, type GitPort } from '@setu/core'
import { OWNER_AUTHOR } from '../data/store'

const HEALTH_PATH = 'site-health.json'

export async function loadHealthState(git: GitPort): Promise<HealthState> {
  const raw = await git.readFile(HEALTH_PATH)
  try {
    return parseHealthState(raw ? (JSON.parse(raw) as unknown) : undefined)
  } catch {
    return parseHealthState(undefined)
  }
}

/** Merge one item/section record (null clears it) and commit site-health.json. */
export async function writeHealthRecord(git: GitPort, kind: 'item' | 'section', id: string, record: AttestationRecord | null): Promise<void> {
  const current = await loadHealthState(git)
  const next = setHealthRecord(current, kind, id, record)
  await git.commitFile({
    path: HEALTH_PATH,
    content: JSON.stringify(next, null, 2) + '\n',
    message: `chore(health): ${record ? record.state : 'clear'} ${kind} ${id}`,
    author: OWNER_AUTHOR,
  })
}
```
> Confirm `GitPort` + `AttestationRecord`/`HealthState` are exported from `@setu/core` (Task 1). Confirm `OWNER_AUTHOR` is exported from `../data/store` (used by the settings forms).

- [ ] **Step 4: Wire `apps/admin/src/health/useAudit.ts`**

Load the health-state, pass it to `runAudit`, and expose `toggle` (writes + re-runs):
```ts
import { useCallback, useEffect, useState } from 'react'
import { runAudit, SITE_CAPABILITIES, type AuditResult } from '@setu/core'
import { useServices } from '../data/store'
import { useSettings } from '../data/settings-store'
import { loadAuditEntries } from './audit-context'
import { loadHealthState, writeHealthRecord } from './health-state'

export function useAudit(): {
  audit: AuditResult | null
  toggle: (kind: 'item' | 'section', id: string, state: 'attested' | 'na' | null) => Promise<void>
} {
  const { git } = useServices()
  const settings = useSettings()
  const [audit, setAudit] = useState<AuditResult | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [entries, health] = await Promise.all([loadAuditEntries(git), loadHealthState(git)])
        const result = runAudit({
          settings: {
            general: { title: settings.general.title, description: settings.general.description },
            reading: { homepage: settings.reading.homepage, searchEngineVisible: settings.reading.searchEngineVisible, feed: { enabled: settings.reading.feed.enabled } },
          },
          entries,
          capabilities: SITE_CAPABILITIES,
          health,
        })
        if (live) setAudit(result)
      } catch {
        /* git unavailable in test stubs — leave audit null */
      }
    })()
    return () => { live = false }
  }, [git, settings, refreshKey])

  const toggle = useCallback(async (kind: 'item' | 'section', id: string, state: 'attested' | 'na' | null) => {
    const record = state ? { state, at: new Date().toISOString(), by: OWNER_AUTHOR_NAME } : null
    await writeHealthRecord(git, kind, id, record)
    setRefreshKey((k) => k + 1)
  }, [git])

  return { audit, toggle }
}
```
Add at the top: `import { OWNER_AUTHOR } from '../data/store'` and `const OWNER_AUTHOR_NAME = OWNER_AUTHOR.name` (or inline `OWNER_AUTHOR.name`). `new Date().toISOString()` is fine here (browser/admin, not a workflow script).

- [ ] **Step 5: Run test + typecheck + commit**

Run: `pnpm --filter @setu/admin test -- health-state-io` → PASS. `pnpm --filter @setu/admin typecheck`. The existing `site-health-card`/`site-health-screen` tests use `SiteHealthCardView`/`SiteHealthView` (presentational) so they're unaffected; the full suite should stay green: `pnpm --filter @setu/admin test`.
```bash
git add apps/admin/src/health/health-state.ts apps/admin/src/health/useAudit.ts apps/admin/test/health-state-io.test.tsx
git commit -m "feat(admin): health-state IO + useAudit attestation toggle"
```

---

## Task 4: Admin — /health UI (attest, N/A, skip section)

**Files:**
- Modify: `apps/admin/src/screens/SiteHealth.tsx`
- Test: `apps/admin/test/site-health-screen.test.tsx` (extend)

**Interfaces:**
- Consumes: `useAudit().toggle` (Task 3); `RUBRIC`, `AuditResult`, `CheckResult` (core); shadcn `Checkbox`/`Switch`.

- [ ] **Step 1: Extend the test (TDD)**

Add to `apps/admin/test/site-health-screen.test.tsx` a fixture with an `unverified` attestable item + an `na` item, plus a `toggle` spy, and assert:
```tsx
it('renders an attest checkbox for unverified items and calls toggle on click', () => {
  const toggle = vi.fn()
  const audit: AuditResult = {
    score: 50, band: 'needs-work', byCategory: [], mustHaves: { done: 1, total: 2 },
    results: [
      { id: 'privacy.policy', status: 'unverified', owner: 'manual', attestable: true },
      { id: 'i18n.hreflang', status: 'na', owner: 'manual', naSource: 'auto' },
    ],
  }
  render(<SiteHealthView audit={audit} toggle={toggle} />)
  // the unverified item shows an "I've verified this" control under "To verify"
  const verify = screen.getByText(/to verify/i).closest('section')!
  const checkbox = within(verify).getByRole('checkbox', { name: /verified/i })
  fireEvent.click(checkbox)
  expect(toggle).toHaveBeenCalledWith('item', 'privacy.policy', 'attested')
  // the auto-na item shows in a Not applicable group, greyed (no toggle)
  expect(screen.getByText(/not applicable/i)).toBeTruthy()
})
```
(Add `vi`, `fireEvent`, `within` imports. Keep the existing grouping-containment test; `SiteHealthView` now takes a `toggle` prop — update the existing test's render to pass a no-op `toggle={() => {}}`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/admin test -- site-health-screen`
Expected: FAIL — `SiteHealthView` doesn't accept `toggle`; no attest checkbox.

- [ ] **Step 3: Rework `apps/admin/src/screens/SiteHealth.tsx`**

`SiteHealthView` now takes `{ audit, toggle }`. Add imports `import { Checkbox } from '@/components/ui/checkbox'` and `import { Button } from '@/components/ui/button'`. Update `Row` to receive `toggle` and render controls; regroup:

```tsx
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
              <Checkbox checked={false} onCheckedChange={() => toggle('item', r.id, 'attested')} aria-label="I've verified this" />
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
        {category && <button className="text-xs text-muted-foreground hover:underline" onClick={() => toggle('section', category, 'na')}>Skip section</button>}
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
      <p className="mb-1 text-xs text-muted-foreground">Audited against the <a className="underline" href="https://specification.website/" target="_blank" rel="noreferrer">Website Specification</a>.</p>
      <p className="mb-6 text-xs text-muted-foreground">"Not applicable" means it doesn't apply to your site — not "skip the work."</p>
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
      <PageBody>{audit ? <SiteHealthView audit={audit} toggle={(k, i, s) => void toggle(k, i, s)} /> : <p className="text-sm text-muted-foreground">Checking…</p>}</PageBody>
    </>
  )
}
```
Add `import type { HealthCategory } from '@setu/core'`. Confirm `apps/admin/src/components/ui/checkbox.tsx` exists (it does per the v1 inventory); if not, add via the shadcn MCP per CLAUDE.md.

- [ ] **Step 4: Run test + typecheck + full suite + commit**

Run: `pnpm --filter @setu/admin test -- site-health-screen` → PASS. `pnpm --filter @setu/admin typecheck` and `pnpm --filter @setu/admin test`.
```bash
git add apps/admin/src/screens/SiteHealth.tsx apps/admin/test/site-health-screen.test.tsx
git commit -m "feat(admin): /health attest checkbox + N/A + skip-section controls"
```

---

## Task 5: Full-rubric sync from the spec MCP

**Files:**
- Create: `scripts/sync-health-rubric.mjs`
- Modify: `packages/core/src/health/rubric.ts` (regenerated/expanded by the script)
- Test: existing `packages/core/test/health-rubric.test.ts` must still pass after expansion.

**Interfaces:** none new (data regeneration).

- [ ] **Step 1: Build the sync script**

`scripts/sync-health-rubric.mjs` (Node, maintainer-run). It POSTs MCP JSON-RPC over Streamable HTTP to `https://mcp.specification.website/mcp` (no auth), calls the `get_checklist` tool, and regenerates `packages/core/src/health/rubric.ts`. Each checklist item → a `RubricItem` (id `category.slug`, the item's category/severity from the spec's Required/Recommended/Optional/Avoid, a **short original paraphrase** for guidance, and `url`). Preserve `liveProbe: true` on the security/performance items. Keep ids stable so existing `EVALUATORS`/`APPLIES_WHEN` keys keep matching.

```js
// scripts/sync-health-rubric.mjs — run: node scripts/sync-health-rubric.mjs
import { writeFileSync } from 'node:fs'
const MCP = 'https://mcp.specification.website/mcp'
async function rpc(method, params) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`MCP ${method} → ${res.status}`)
  const text = await res.text()
  // Streamable HTTP may return SSE — extract the JSON data line(s).
  const json = text.includes('data:') ? JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('')) : JSON.parse(text)
  return json.result
}
// 1) get_checklist → markdown; 2) parse sections/items → RubricItem[]; 3) write rubric.ts
// (Implement the markdown→items parse to match the spec's checklist structure; map
//  Required→required / Recommended→recommended / Optional→optional / Avoid→avoid.)
```
> If the MCP is unreachable from the build environment, report **BLOCKED** with the error — this task then runs as a maintainer step on a networked machine. The engine (Tasks 1–4) does not depend on the expansion.

- [ ] **Step 2: Run the sync + verify the rubric**

Run: `node scripts/sync-health-rubric.mjs` then `pnpm --filter @setu/core test -- health-rubric` (unique ids, valid category/severity, non-empty title/guidance, url under `https://specification.website`). Confirm `EVALUATORS`/`APPLIES_WHEN` keys still resolve to real ids (`pnpm --filter @setu/core test -- health-audit`).

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-health-rubric.mjs packages/core/src/health/rubric.ts
git commit -m "feat(health): full-rubric sync script + expanded rubric from specification.website"
```

**Final:** whole-branch review (`superpowers:requesting-code-review`, include the CLAUDE.md polish + UAT verdict), then `superpowers:finishing-a-development-branch`.

---

## Self-Review (author checklist — completed)

**1. Spec coverage:** Git health-state + types (T1); resolution order + applicability + na-scoring + auto-supersedes (T2); admin IO + useAudit toggle (T3); attest/N-A/skip-section UI (T4); full-rubric MCP sync (T5). Honest-completeness scoring (unverified counts, na excluded) → T2. i18n auto-N/A → T2 `APPLIES_WHEN`. N/A copy → T4. ✅ v2 live probes + emitters remain out of scope (spec Non-Goals).

**2. Placeholder scan:** No TBD/TODO. T5's markdown→items parse is described against the spec's known structure (Required/Recommended/Optional/Avoid) with a BLOCKED fallback if the network is unavailable — the one genuinely environment-dependent step, flagged as such, not a hand-wave. All other steps carry complete code.

**3. Type consistency:** `CheckStatus` (`pass|fail|unverified|pending|na`), `AttestationRecord`/`HealthState`, `CheckResult.{attestable,naSource}`, `AuditContext.health`, `parseHealthState`/`setHealthRecord`, `APPLIES_WHEN`, `loadHealthState`/`writeHealthRecord`, `useAudit().toggle`, and `SiteHealthView({audit,toggle})` are consistent across T1–T5. v1's `manual` status is fully migrated to `unverified` (T2 test + run-audit). Resolution-order precedence (na → evaluator → attested → unverified/pending) matches the spec.

**Open questions:** O1 (dedicated `site-health.json` — chosen), O2 (category-level `appliesWhen` — chosen), O3 (engine first, sync last as T5 — chosen) all resolved above.
