# Basic Forms — Design

**Date:** 2026-06-24
**Status:** Approved (brainstorm complete) — ready for implementation plan
**Branch:** `forms-basic`

## Summary

Add a **basic forms** capability to Setu: a single polished `contact` block authors can
drop into a page, a server-side submission pipeline that prevents spam and stores
submissions, an email notification on submit, and a real submissions **inbox** in the admin
(`/forms`, currently a placeholder).

This is the free-tier cut. It is deliberately *finished to table-stakes* (per the project
quality bar) but stops short of anything genuinely advanced — those are explicitly reserved
as **pro** features (see Non-Goals).

Forms are the canonical example of the "what kind of data is this?" rule established in the
architecture discussions: a submission is **runtime, visitor-generated, accumulating,
untrusted data → DB-shaped**. So submissions live in the database, not Git. Git-sync of
submissions (the "DB buffer → sync to Git" pattern roadmapped for comments) stays a
future/pro move and is out of scope here.

## Goals

- An author can place a `contact` block on any page and configure it without code.
- A visitor can submit the form; spam is blocked **before** anything is stored.
- The site owner is **emailed** when a submission arrives, and can also read/triage all
  submissions in an admin inbox.
- The whole feature works **end-to-end in dev and self-hosted** topologies (`apps/api` +
  `db-sqlite`) in v1.
- Every new boundary (submission storage, email sending) is a **port with adapters**, so
  the edge topology (Cloudflare Pages Function + `db-d1` + CF email binding) drops in later
  with no rework to the handler or UI.

## Non-Goals (explicitly deferred — most are **pro**)

- Form **builder** / arbitrary custom fields / add-remove-reorder fields.
- Multi-step forms, conditional logic.
- File-upload fields.
- Webhooks / third-party integrations (Zapier, CRM, etc.).
- **Akismet-style spam *filtering*** (scoring/quarantining stored messages). We *prevent*
  spam at the door; a filtering *service* is a separate pro product.
- Submission analytics / dashboards.
- Git-sync of submissions.
- The actual **edge deployment** (Cloudflare Pages Function) of the submit endpoint — built
  later behind the same seams; v1 targets dev + self-hosted.

## Architecture overview

```
                 (static page, Cloudflare Pages target)
  blocks/contact/contact.astro  +  submit island (JS)
        │  POST { formId, fields, turnstileToken, honeypot, source }
        ▼
  apps/api  POST /forms/submit   ──►  createSubmissionService (core, topology-agnostic)
                                         1. honeypot check
                                         2. Turnstile verify (server-side, secret key)
                                         3. validate (required + email format)
                                         4. SubmissionPort.saveSubmission()   ──► db-sqlite
                                         5. best-effort notify (non-blocking)  ──► EmailPort
                                                                                    └─ React Email render → HTML
        ▲
  apps/admin  /forms inbox  ──►  SubmissionPort (list/get/update/delete/export/search)
```

Two new ports, mirroring the existing `GitPort` / `DataPort` grain:

- **`SubmissionPort`** — storage for form submissions.
- **`EmailPort`** — provider-agnostic email sending.

Plus a **topology-agnostic core service** (`createSubmissionService`) holding the submit
pipeline, wired into `apps/api` now and a Pages Function later — identical logic, different
host.

## Components

### 1. The `contact` block (`blocks/contact/`)

Uses the existing folder-based block model (`block.ts` Zod contract + editor meta +
`contact.astro`), category **`widget`**.

**Fixed fields:** `name`, `email`, `message`, plus an optional `subject`.

**Author-configurable props (Zod):**
- `formId` (string, required) — stable id that attributes submissions in the inbox.
- `formLabel` (string, optional) — human label shown in the inbox; defaults to `formId`.
- per-field `required` toggles (name/subject/message; `email` always required).
- per-field `label` and `placeholder` overrides.
- `successMessage` (string) — shown after a successful submit.

**No** add/remove/reorder of fields (that is the pro builder).

`contact.astro` renders a semantic `<form>` with proper labels and a hidden **honeypot**
field, plus a small **JS island** that:
- renders the **Turnstile** widget (public site key),
- does client-side validation (required + email shape) for fast feedback,
- POSTs to the configured API base,
- shows success (`successMessage`) / error / loading states.

Progressive-enhancement note: the form is real HTML; the island enhances it. (A no-JS
fallback POST is desirable but not required for v1 — see Open question O1.)

### 2. Spam prevention (free, at submit time)

- **Cloudflare Turnstile** — public **site key** in the rendered widget; **secret key**
  verified server-side via Turnstile `siteverify` before storing. Chosen over reCAPTCHA:
  free with no quota, Cloudflare-native (our deploy target), privacy-friendly, no Google
  dependency.
- **Honeypot** — a hidden field; if filled, the submission is silently dropped (return ok,
  store nothing) so bots get no signal.

Failed checks are rejected **before** persistence — the inbox only ever contains legitimate
submissions. There is therefore **no "spam" status** in the inbox.

### 3. `SubmissionPort` (new, `packages/core`)

Separate from `DataPort` (drafts/locks) — different concern, keep `DataPort` lean.

```ts
interface Submission {
  id: string
  formId: string
  formLabel?: string
  fields: Record<string, string>   // name/email/subject/message
  createdAt: string                 // ISO
  read: boolean
  source?: { url?: string; referrer?: string; userAgent?: string }
}

interface SubmissionFilter {
  formId?: string
  read?: boolean
  q?: string                        // full-text over fields (basic LIKE)
  limit?: number
  offset?: number
}

interface SubmissionPort {
  saveSubmission(input: Omit<Submission, 'id' | 'createdAt' | 'read'>): Promise<Submission>
  getSubmission(id: string): Promise<Submission | null>
  listSubmissions(filter?: SubmissionFilter): Promise<{ rows: Submission[]; total: number }>
  setRead(ids: string[], read: boolean): Promise<void>
  deleteSubmissions(ids: string[]): Promise<void>
  distinctForms(): Promise<{ formId: string; formLabel?: string; count: number }[]>  // inbox filter
  close(): Promise<void>
}
```

- **v1 adapter:** `db-sqlite` (Drizzle + better-sqlite3) — a `submissions` table.
- **Later (behind same port):** `db-d1` (edge), `db-idb` (browser).
- A shared `runSubmissionPortContract` (like `runGitPortContract` / `runDataPortContract`)
  exercises every adapter, including: save round-trips, filter by form/read/`q`,
  `setRead` idempotence, delete, `distinctForms` counts, pagination (`limit`/`offset` +
  `total`).
- CSV **export** is derived from `listSubmissions` (no special port verb) — the admin maps
  rows to CSV.

### 4. Submission handler — `createSubmissionService` (core)

Topology-agnostic; injected with its dependencies so it runs unchanged in `apps/api` and a
future Worker.

```ts
createSubmissionService({
  submissions: SubmissionPort,
  email?: EmailPort,                 // optional; absent → no notification
  verifyTurnstile: (token, ip?) => Promise<boolean>,
  notifyTo?: string,                 // owner address for notifications
  notifyFrom?: string,
})
  .submit(input: {
    formId, formLabel?, fields, turnstileToken, honeypot, source?, ip?
  }): Promise<{ ok: true } | { ok: false; error: 'spam' | 'invalid' | 'server' }>
```

Pipeline: honeypot → Turnstile verify → validate (required + email format) → `saveSubmission`
→ **best-effort** email notify (failures logged, never fail the submission) → `{ ok: true }`.

`verifyTurnstile` is injected (not hard-coded) so it can be stubbed in tests and swapped per
host.

### 5. `EmailPort` (new) + adapters + React Email

```ts
interface EmailMessage { to: string; from: string; subject: string; html: string; text?: string }
interface EmailPort { send(msg: EmailMessage): Promise<void> }
```

- **v1 adapters:** `email-console` (logs the message — zero-config dev default) and
  `email-resend` (Resend SDK; works Node + edge). Selected by env/config.
- **Documented seams (not built in v1):** `email-smtp` (nodemailer — **Node/self-hosted
  only**, no Cloudflare Workers TCP), `email-ses` (AWS SDK), `email-cloudflare` (native
  `send_email` Workers binding — lands with the edge deploy).
- **React Email** renders the notification body: a `SubmissionNotification` template
  (`render(<SubmissionNotification .../>)` → HTML), provider-agnostic so it works across
  every adapter. Runs server-side in `apps/api` (Node) for v1; edge-render verified later.

### 6. Admin inbox (`apps/admin`, `/forms`)

Replaces the `Placeholder`. Reads exclusively via `SubmissionPort` (through the admin's
service bundle / API in the relevant topology).

- **List:** newest-first, **filter by form** (from `distinctForms`), **unread badge**,
  **search** (`q`), pagination.
- **Detail:** view a single submission's fields + metadata (date, form, source).
- **Triage:** mark read/unread; delete.
- **Bulk actions:** bulk delete, bulk mark-read/unread (reuse the existing bulk-ops
  selection pattern from the listing).
- **Export:** CSV of the current filtered set.

No spam bucket (spam is prevented upstream). Interaction polish is table-stakes
(keyboard affordances, clear feedback via the existing `useNotify`), per the project's
definition of done.

## Configuration

Env / site config (names indicative; finalized in the plan):

- `TURNSTILE_SITE_KEY` (public; surfaced to the block via site config) and
  `TURNSTILE_SECRET_KEY` (server, `apps/api`).
- `RESEND_API_KEY` (only when the Resend adapter is selected).
- `FORMS_NOTIFY_TO` / `FORMS_NOTIFY_FROM` — notification addresses.
- `EMAIL_ADAPTER` — `console` (default) | `resend`.
- API base URL for the form POST — from site config (so the static site knows where to
  submit in each topology).

When required config is absent, fail safe: no Turnstile keys → reject configuration at
build/start with a clear error (don't silently accept spam); no email config → fall back to
`email-console` and still store the submission.

## Error handling

- **Spam / honeypot:** return a generic `ok`-shaped response to the bot (no signal); store
  nothing.
- **Turnstile fail:** `{ ok: false, error: 'spam' }`; the block shows a retry message.
- **Validation fail:** `{ ok: false, error: 'invalid' }` with which fields; block highlights
  them.
- **Email send fail:** logged, **non-blocking** — the submission is already stored, so the
  record is never lost because a provider hiccuped.
- **Storage fail:** `{ ok: false, error: 'server' }`; block shows a generic error.

## Testing

- `runSubmissionPortContract` across `db-sqlite` (and `db-memory` for fast tests) — CRUD,
  filters, search, `distinctForms`, pagination.
- `createSubmissionService` unit tests with stubbed `verifyTurnstile` / in-memory
  `SubmissionPort` / fake `EmailPort`: honeypot drop, Turnstile reject, validation reject,
  happy path persists + notifies, email failure is non-blocking.
- `apps/api` route test for `POST /forms/submit`.
- `EmailPort` console adapter test; Resend adapter behind a mocked client.
- Admin inbox: list/filter/search/mark-read/delete/bulk/export behavior.
- React Email template renders to non-empty HTML.

## Topology / rollout

- **v1:** dev + self-hosted — `apps/api` hosts `POST /forms/submit`; `db-sqlite` stores;
  `email-console`/`email-resend` notify. Fully end-to-end.
- **Fast-follow (out of scope):** edge — a Cloudflare Pages Function reusing
  `createSubmissionService`, `db-d1` adapter, `email-cloudflare` adapter. No changes to the
  block, handler logic, ports, or inbox.

## Open questions (resolve during planning)

- **O1 — no-JS fallback:** ship a progressive-enhancement non-JS POST fallback in v1, or
  require JS (island-only)? Leaning island-only for v1, fallback as a small follow-up.
- **O2 — config surface:** exact site-config vs env split for Turnstile site key + API base
  (the block needs the site key at render; the handler needs the secret at runtime).
- **O3 — submission id strategy:** uuid in the adapter vs DB autoincrement + public id.

## Decisions log (from brainstorm)

- Scope: contact block + inbox + email + Turnstile (free); builder/etc. pro. **(A)**
- Spam: Turnstile + honeypot, rejected at submit time; **no inbox spam bucket**; Akismet =
  future pro filtering service.
- Block: fixed fields + light props; no field builder. **(A)**
- Data path: new `SubmissionPort`, `db-sqlite` now, DB not Git, edge later. **(A)**
- Email: in v1, **pluggable** `EmailPort` + Resend default + console dev + **React Email**
  templates; SES/SMTP/CF-binding as seams. **(B + pluggable)**
- Inbox: list + filter-by-form + unread + detail + delete + CSV export + search + bulk;
  minus spam. **(A + C − spam)**
