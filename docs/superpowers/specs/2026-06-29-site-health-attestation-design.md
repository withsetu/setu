# Site Health v2 — Attestation, Applicability & Full Rubric — Design

**Date:** 2026-06-29
**Status:** Approved (brainstorm complete) — ready for implementation plan
**Branch:** `site-health-v2` (branched off `site-health`; **rebase onto `main` once PR #61 merges** — this extends v1's `runAudit` + `/health`)

## Summary

Builds on the shipped Site Health v1 ([[setu-site-health]], PR #61). Three coupled additions that
make the scorecard **honest and tailorable**:
1. **Full rubric** — sync the complete specification.website checklist (~148 items) into the
   vendored rubric so the *whole* backlog is visible, not just the 34-item v1 subset.
2. **Manual attestation** — every item Setu can't auto-verify gets an "I've verified this"
   checkbox; ticking it counts the item as a **pass**. When Setu later auto-checks that item, the
   **auto result supersedes** the manual attestation.
3. **Applicability (N/A)** — items/sections that don't apply are **excluded from the score**:
   **auto-detected** where Setu can tell (Internationalisation is N/A on a single-locale site, and
   switches on the moment a second locale appears), and a **manual "Not applicable" toggle** where
   only the owner knows (web-app manifest, service worker, cookie-consent…).

All attestation/applicability state is **Git-backed** (owned, versioned, portable — no DB),
consistent with `settings.json`.

## Goals

- A Git-backed health-state file (`site-health.json`) of per-item `attested | na` (+ who/when),
  written via the existing `git.commitFile` path.
- Rubric items carry an optional **`appliesWhen(ctx)`** (auto-applicability) alongside the
  existing `owner`/`severity`/`liveProbe`.
- `runAudit` resolves each item through the **resolution order** below; **N/A excluded** from the
  score; attested → pass; auto evaluator supersedes attestation.
- The `/health` screen gains attest checkboxes + N/A toggles (item + "skip section"); toggling
  commits the health-state and recomputes live.
- A maintainer sync script (`scripts/sync-health-rubric.mjs`) regenerates the rubric from the
  spec's MCP toward the full ~148; unclassified items default to **manual** (so they list +
  become attestable immediately).

## Non-Goals (deferred)

- **v2 live probes** (security-header fetch, CWV) remain a separate increment — those items stay
  `liveProbe`/`pending` here, but are now *also manually attestable* in the interim.
- The **emitters** (canonical, OG, sitemap, …) — still their own increments; this only changes
  how their gaps are scored/skipped, not whether Setu emits them.
- A **site-profile** system (e.g. "this is a blog, not a PWA" auto-N/A-ing whole groups) — YAGNI;
  per-item/section manual N/A + the one auto-detector (locale) covers it. Noted as a future idea.
- Attestation **expiry/staleness nudges** — we store `at` (timestamp) and show "verified on
  DATE", but no auto-expiry in v2.
- Overriding an **auto** check (e.g. a custom theme that does emit canonical) — auto items aren't
  manually overridable in v2; the capability map is the source of truth for the default pipeline.

## Architecture

```
@setu/core/health
  types.ts        + HealthState, AttestationRecord; CheckResult.status gains 'na' | 'unverified'
  rubric.ts       items + optional appliesWhen(ctx); grown toward ~148 via the sync script
  checks.ts       appliesWhen predicates (e.g. i18n: localeCount(ctx) > 1) colocated w/ evaluators
  run-audit.ts    resolution order (below); N/A excluded from score; attested→pass; auto wins
        ▲ context = { settings, entries, capabilities, health }   ← health added
        │
apps/admin
  data: settings-store + content index + capability map + site-health.json (new loader/writer)
  /health screen: attest checkbox + N/A toggle per row, "Skip section" per section → commit + re-run
scripts/sync-health-rubric.mjs   maintainer-only: pulls the full checklist from the spec MCP → rubric.ts
```

### 1. Git health-state (`site-health.json`)

A committed file at the content root (sibling of `settings.json`):

```ts
interface AttestationRecord { state: 'attested' | 'na'; at: string /* ISO */; by: string }
interface HealthState {
  items: Record<string, AttestationRecord>   // keyed by rubric item id
  sections: Record<string, AttestationRecord> // keyed by category — a "skip section" sets na
}
```
Read by a core loader `parseHealthState(raw): HealthState` (never throws → empty default). Written
by the admin via `git.commitFile({ path: 'site-health.json', ..., author: OWNER_AUTHOR })`. A
section-level `na` is equivalent to N/A-ing every item in that category (resolved at audit time).

### 2. Rubric: auto-applicability

Rubric items keep their data shape; **applicability predicates live in the registry** (colocated
with evaluators, since they read `ctx`), keyed by item id or category:

```ts
// checks.ts
export const APPLIES_WHEN: Record<string, (ctx: AuditContext) => boolean> = {
  // Internationalisation applies only when the site has more than one content locale.
  'i18n': (ctx) => localeCount(ctx) > 1,          // category-level predicate
  // (add per-item predicates as needed, e.g. 'foundations.feed': hasPosts)
}
function localeCount(ctx: AuditContext): number {
  return new Set(ctx.entries.map((e) => e.id.split('/')[1])).size
}
```
Category-level predicates apply to every item in that category unless an item has its own.

### 3. `runAudit` resolution order (the crux)

`AuditContext` gains `health: HealthState`. For each rubric item, in order:
1. **N/A (→ `na`, excluded)** if the admin set the item or its section to `na`, **or** an
   `appliesWhen` predicate returns `false` (auto, e.g. i18n single-locale).
2. else **auto-evaluator** present → its `pass`/`fail` (auto wins; any manual attestation on this
   id is ignored — this is how the manual value is "dropped" once auto-checking lands).
3. else **attested** (`health.items[id].state === 'attested'`) → `pass` (owner stays the item's,
   detail "Self-verified on DATE").
4. else **not-passed**: `pending` if `liveProbe`, otherwise `unverified` (applicable, not verified).

**Status set** becomes `pass | fail | unverified | pending | na`. **Scoring:** `pass` weight ÷
(`pass`+`fail`+`unverified`+`pending`) weight; **`na` excluded**. (Previously `manual`/`pending`
were excluded; now applicable-unverified counts as not-passed — the honest-completeness model the
owner approved.) `mustHaves` counts `required` items that are `pass`/total-applicable, excluding
`na`.

### 4. `/health` UI

Each item row, by status:
- **Auto** (`pass`/`fail`): unchanged (no checkbox — Setu knows).
- **`unverified`/`pending` & owner-attestable**: an **attest checkbox** ("I've verified this").
- **Owner-decidable applicability**: a **"Not applicable"** toggle (shadcn `Switch`/`Checkbox`).
- **Auto-N/A** (e.g. i18n single-locale): row shown **greyed/collapsed** — "Not applicable — no
  other locales" — not togglable (Setu decides).
Section headers get **"Skip this section"** (sets the category `na`). Any toggle → write
`site-health.json` → recompute the audit (live). Copy near the controls: *"N/A means this doesn't
apply to your site — not 'skip the work.'"* `na` items render in a collapsed "Not applicable"
group, out of the scored sections.

### 5. Full-rubric sync

`scripts/sync-health-rubric.mjs` (maintainer-only, Node) calls the spec MCP
(`https://mcp.specification.website/mcp` — `get_checklist`/`list_topics`/`get_topic`) and
regenerates `packages/core/src/health/rubric.ts`: every checklist item becomes a `RubricItem`
with category/severity/title/short-paraphrased-guidance/url. Items with a registered evaluator
keep auto behavior; the rest default to **manual** (listed + attestable). Run by a human; the app
never calls the MCP. (Verify the spec's license before storing guidance text — default to
original paraphrase + deep link, as in v1.)

## Data flow

Admin loads settings + committed content + capability map + `site-health.json` → `runAudit`
(pure over all four) → grouped report + score (N/A excluded). Admin ticks attest / sets N/A /
skips a section → commit `site-health.json` (preserving the rest) → re-run → score updates. A
multilingual site auto-includes i18n; a single-locale site auto-excludes it.

## Error handling

- Missing/malformed `site-health.json` → empty `HealthState` (every item unattested + applicable;
  never throws).
- An attestation whose id later gains an auto-evaluator → silently ignored (auto wins); stale
  attestation records are harmless (cleaned up opportunistically, not required).
- A section `na` plus an item-level record in that section → the more specific item record wins
  for that item; otherwise the section default applies.
- Commit failure on toggle → notify + leave the prior state (the UI reflects the last committed
  state on reload).
- Empty content → `localeCount` = 0 → i18n auto-N/A (correct; nothing to translate).

## Testing

- **Core (resolution order):** `na` (manual + auto via `appliesWhen`) excluded from score;
  attested → pass; **auto-evaluator supersedes an attestation** for the same id; `unverified`
  vs `pending` for non-auto items; section-`na` excludes all its items; item record overrides
  section default.
- **Scoring with N/A:** denominator excludes `na`; must-haves skip `na`; band recomputes.
- **`appliesWhen`:** i18n N/A at localeCount ≤ 1, applies at ≥ 2.
- **Health-state IO:** `parseHealthState` defaults/never-throws; admin write commits
  `site-health.json` with the toggled record and preserves others.
- **`/health` toggle round-trip (admin):** ticking attest moves an item from "unverified" into
  passing and bumps the score; "Skip section" removes a section from scoring.
- **Sync script:** dry-run/shape test that generated items satisfy the `RubricItem` contract
  (unique ids, valid category/severity) — reuse the v1 rubric test.

## Rollout / dependencies & branch coordination

- **Depends on PR #61** (v1). This branch is off `site-health`; **rebase onto `main` after #61
  merges** before implementing (the v1 files this extends must be in main). No new runtime deps.
- `CheckStatus` gains `'na' | 'unverified'` (was `pass|fail|manual|pending`); v1's `manual`
  usages migrate to `unverified` (applicable) — confirm no consumer asserts the old set.
- Admin UI uses existing shadcn `Checkbox`/`Switch` (add via the shadcn MCP only if missing).
- The sync script's full-148 import is large data; the plan may land it as its own task (engine
  works on any rubric size, so the engine + UI can land first, the full sync second).

## Open questions (resolve during planning)

- **O1 — health-state file vs a `health` block in `settings.json`:** a dedicated
  `site-health.json` (chosen — keeps settings clean, distinct write cadence) vs nesting under
  settings. Lean: dedicated file.
- **O2 — `appliesWhen` granularity:** category-level predicates only (chosen for v2, covers
  i18n) vs per-item too. Lean: category-level now, per-item when a case appears.
- **O3 — engine-first vs full-148-first:** land attestation+applicability on the current rubric
  first, then the full sync (chosen — engine is independently valuable) vs sync first. Lean:
  engine first within the same increment; sync as the last task.

## Decisions log (from brainstorm)

- **Git storage** for attestation/applicability (not DB) — owner-asserted, versioned, portable;
  consistent with settings. **(approved)**
- **Honest-completeness scoring:** pass = auto-pass or attested; applicable-unverified counts as
  not-passed; **N/A excluded**. **(approved)**
- **Two kinds of N/A:** auto-detected (i18n ← locale count) + manual toggle (PWA/manifest etc.);
  item + section granularity. **(approved)**
- **Auto supersedes manual** — when an item gains an auto-evaluator, its attestation is dropped.
  **(approved)**
- **Full-148 rubric** synced via the spec MCP (maintainer-time); unclassified → manual/attestable.
  **(approved)**
