# Pluggable Spam Protection (Captcha) — Design

**Date:** 2026-06-25
**Status:** Approved (brainstorm complete) — ready for implementation plan
**Branch:** `pluggable-captcha` (off `main`)

## Summary

Basic forms shipped with **Cloudflare Turnstile baked into `@setu/core`** as the only spam
option, with a Turnstile-specific client widget. This slice turns spam protection into a
**port + adapter** capability (the pattern Setu uses for email/storage/git): a provider-
agnostic `CaptchaPort` in core, separate provider packages you include to activate
(`@setu/captcha-turnstile`, `@setu/captcha-recaptcha`), and a provider-agnostic client
widget. Secret keys live **only in environment variables** — never in the database, never in
Git, never entered through the admin UI.

This is a refactor + extension of the just-shipped forms spam protection — no change to the
submission storage, inbox, or email.

## Goals

- **Pluggable providers:** including a captcha adapter package (and setting its keys) protects
  the forms; including none leaves them unprotected in dev / flagged as misconfigured in prod.
- **Two providers at launch:** Turnstile (extracted from core) and **reCAPTCHA v2**.
- **Core stays provider-agnostic:** core defines the `CaptchaPort` contract only; no provider
  code in core.
- **Safe key storage:** the **secret** key is an environment variable, server-side only —
  never persisted to the DB or Git, never accepted by an admin form. The **public site key**
  (which is exposed in page HTML anyway) is non-secret config.
- **Verifiable setup:** the admin can see *whether* a provider is configured (a boolean
  status) without the secret ever reaching the browser or the app's data.

## Non-Goals (YAGNI / deferred)

- **reCAPTCHA v3** (invisible, score-threshold model — different shape from a rendered widget).
- Other providers (hCaptcha, etc.) — trivially another adapter later.
- Per-form provider override (one site-wide provider for v1).
- An admin form that **stores** secret keys (deliberately excluded — secrets stay in env).
- Any change to submission storage, the inbox, or email.

## Architecture

```
                         CaptchaPort  (interface, @setu/core)
                              ▲                    ▲
          server verify ──────┤                    ├────── client widget
   @setu/captcha-turnstile    │                    │   provider-agnostic island
   @setu/captcha-recaptcha    │                    │   (loads provider script,
   createXxxCaptcha({secret}) │                    │    renders widget, yields token)
                              │                    │
   apps/api boot: pick adapter by env secret       contact.astro passes {provider, siteKey}
   → createSubmissionService({ captcha })           from PUBLIC_* config to the island
```

### 1. `CaptchaPort` in core (interface only)

Generalize the current Turnstile-specific `TurnstileVerifier` into:

```ts
// @setu/core
export interface CaptchaPort {
  /** Verify a client captcha token. Fail-closed: any error → false. */
  verify(token: string, remoteip?: string): Promise<boolean>
}
/** Dev/no-provider pass-through (accepts everything). Explicit + named so it
 *  never gets confused for a real verifier. */
export function createNoopCaptcha(): CaptchaPort
```

- `createSubmissionService` takes `captcha: CaptchaPort` (replacing `verifyTurnstile`).
- The submit input's `turnstileToken` field becomes the provider-neutral **`captchaToken`**
  (in `SubmitInput`, the contact client `submitContact`, and the `/forms/submit` body).
- Core no longer exports `createTurnstileVerifier`/`TurnstileVerifier`.

### 2. Provider adapter packages (server verify)

Mirror `@setu/email-resend` / `@setu/email-console`:

- **`@setu/captcha-turnstile`** — move the current `packages/core/src/submissions/turnstile.ts`
  here. `createTurnstileCaptcha({ secret, fetchImpl? }): CaptchaPort` (POSTs to Turnstile
  `siteverify`, fail-closed).
- **`@setu/captcha-recaptcha`** — new. `createRecaptchaCaptcha({ secret, fetchImpl? }):
  CaptchaPort` (POSTs to Google reCAPTCHA `siteverify`, fail-closed; reCAPTCHA **v2**
  response shape `{ success: boolean }`).
- A shared **`runCaptchaPortContract`** (in the testing package) both adapters pass, using an
  injected `fetchImpl` (success → true, failure → false, throw → false, non-OK → false).

### 3. Client widget pluggability

Today the island hardcodes Turnstile (`window.turnstile.render`, and `contact.astro` loads
Turnstile's `api.js`). Make it provider-driven:

- A small **client captcha renderer** keyed by provider:
  `mountCaptcha({ provider, siteKey, el, onToken, onExpire }): () => void` — it **injects the
  provider's script** (Turnstile `api.js?render=explicit` / reCAPTCHA `api.js?render=explicit`),
  renders the widget into `el`, and calls `onToken(token)`. Returns a cleanup/reset handle.
  (Turnstile and reCAPTCHA v2 share this shape.)
- The `ContactForm` island calls `mountCaptcha` with the configured `provider` + `siteKey`
  instead of Turnstile-specific code. The hardcoded Turnstile `<script>` is removed from
  `contact.astro`; the renderer injects the right script.
- Placement of the renderer (a `/client` entry in each captcha package, vs a single switch in
  `@setu/blocks`) is an open question (O1) — leaning a single small switch in `@setu/blocks`
  to keep the island's dependency surface flat.

### 4. Configuration & key storage (the safety core)

- **Secret key → environment variable only**, read at the API/Worker composition root and
  handed to the adapter factory. Never written to the DB, never committed to Git, **never
  accepted by an admin form**. Per-provider names (clearer; lets you stage a swap):
  `SETU_TURNSTILE_SECRET`, `SETU_RECAPTCHA_SECRET`.
- **Active provider + public site key → non-secret config.** The site key is rendered into the
  page (public by design), so it is not a secret. Configured via `PUBLIC_*` env consumed by
  the site build: `PUBLIC_CAPTCHA_PROVIDER` (`turnstile` | `recaptcha` | unset), and a
  per-provider public site key (`PUBLIC_TURNSTILE_SITE_KEY` / `PUBLIC_RECAPTCHA_SITE_KEY`),
  or a single `PUBLIC_CAPTCHA_SITE_KEY` paired with the provider. (Naming finalized in the
  plan.)
- **Admin read-only status (no secret entry):** a Settings affordance "Spam protection" shows
  the active provider and whether the secret is configured — e.g. **"Turnstile — secret
  detected ✓"** — by calling a small API endpoint that returns **booleans only** (`{ provider,
  secretConfigured: true }`), computed from `process.env` server-side. The secret value never
  leaves the server. No input field for the secret exists.
- **No provider configured:** the API boot selects `createNoopCaptcha()` (dev pass-through, so
  forms work locally with zero keys). In production, an unset secret while a provider is
  selected is a **misconfiguration** — log a clear warning at boot and (decision) **reject**
  submissions rather than silently accept, so a misconfigured deploy never runs unprotected.

### 5. Migrating what's already built

- Delete `packages/core/src/submissions/turnstile.ts`; remove its barrel exports; add
  `CaptchaPort` + `createNoopCaptcha` to core.
- `submission-service.ts`: `verifyTurnstile` dep → `captcha: CaptchaPort`; `turnstileToken` →
  `captchaToken` (and in `SubmitInput`).
- `contact-form.ts` (`submitContact`) + `/forms/submit` route: rename token field to
  `captchaToken`.
- `apps/api/server.ts`: select the adapter from env (provider + secret) → `captcha`; fall back
  to `createNoopCaptcha()` when unset (dev) / warn+reject in prod.
- `ContactForm.tsx` + `contact.astro`: provider-agnostic widget via `mountCaptcha`; pass
  `provider` + `siteKey` from `PUBLIC_*` config.
- Keep the existing fail-closed + honeypot behavior intact.

## Error handling

- Every adapter is **fail-closed**: non-OK HTTP, `success !== true`, malformed JSON, or a
  thrown request → `verify` returns `false`.
- Missing token at the service → `{ ok: false, error: 'spam' }` (unchanged).
- No provider in prod (misconfig) → reject with a server error + a boot warning (never silent
  pass-through in prod).
- Client: if the widget script fails to load / never yields a token, submit is blocked with
  the existing "please try again" path (unchanged).

## Testing

- `runCaptchaPortContract(makeAdapter)` across `captcha-turnstile` + `captcha-recaptcha` with
  injected `fetchImpl`: success→true, failure→false, throw→false, non-OK→false, correct
  request shape (form-encoded `secret`+`response`, optional `remoteip`).
- `createSubmissionService` tests updated to inject a fake `CaptchaPort` (spam-reject, happy
  path) — behavior unchanged, just the dependency shape.
- `createNoopCaptcha` returns true.
- Client `mountCaptcha`: unit-test the pure parts (provider→script-url, token plumbing) with a
  faked global; full widget render verified by UAT (mirrors the existing island approach).
- The admin status endpoint returns booleans only (never the secret).

## Open questions (resolve during planning)

- **O1 — client renderer placement:** a `/client` entry per captcha package vs a single
  `mountCaptcha` switch in `@setu/blocks`. Leaning the `@setu/blocks` switch (flat island deps,
  no per-provider client package). 
- **O2 — public config naming:** `PUBLIC_CAPTCHA_PROVIDER` + per-provider site-key vars vs a
  single `PUBLIC_CAPTCHA_SITE_KEY`. Leaning provider + single site-key var (one active
  provider).
- **O3 — status endpoint home:** extend the forms API with `GET /forms/captcha-status`
  (booleans) vs a generic settings/config endpoint. Leaning the forms API (keeps it local).
- **O4 — prod misconfig policy:** confirm "reject submissions when a provider is selected but
  its secret is unset" (vs warn-and-pass). Spec assumes **reject** (safer).

## Decisions log (from brainstorm)

- Pluggable **CaptchaPort + adapter packages**; Turnstile extracted from core. **(approved)**
- Providers v1: **Turnstile + reCAPTCHA v2**; v3 deferred. **(a)**
- Admin **read-only "configured ✓" status** (no secret entry). **(b)**
- **Per-provider env names** for secrets. **(c)**
- Secret keys: **env only**, never DB/Git/admin-UI. Public site key: non-secret config.
