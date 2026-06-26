# Pluggable Spam Protection (Captcha) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn forms spam protection into a port + adapter capability — a provider-agnostic `CaptchaPort` in core, Turnstile + reCAPTCHA-v2 adapter packages, and a provider-agnostic client widget — with secret keys living only in environment variables.

**Architecture:** `CaptchaPort` (interface only) in `@setu/core`; provider packages `@setu/captcha-turnstile` / `@setu/captcha-recaptcha` (server verify) mirroring the `email-*` packages; a client `mountCaptcha` switch in `@setu/blocks` that injects the chosen provider's script + renders its widget; the API selects an adapter by env at boot; secrets are env-only, the public site key is non-secret config, and the admin shows a read-only "configured" status.

**Tech Stack:** TypeScript (strict), Vitest, Hono, Astro + React island, Cloudflare Turnstile + Google reCAPTCHA v2 siteverify.

## Global Constraints

- TS strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (use `import type`), `isolatedModules`.
- Leaf-package conventions: `@setu/<name>`, `"type":"module"`, `main`/`types`/`exports` → `./src/index.ts`, `license:"AGPL-3.0-only"`; `tsconfig.json` = `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": [] }, "include": ["src", "test"] }`. After adding a package/dep run `pnpm install`.
- **Secret keys are environment variables only** — never written to the DB, never committed to Git, never accepted by an admin form. Per-provider names: `SETU_TURNSTILE_SECRET`, `SETU_RECAPTCHA_SECRET`.
- **Public site key + provider** are non-secret config via `PUBLIC_*` env: `PUBLIC_CAPTCHA_PROVIDER` (`turnstile`|`recaptcha`|unset), `PUBLIC_CAPTCHA_SITE_KEY`.
- Every captcha adapter is **fail-closed**: non-OK HTTP, `success !== true`, malformed JSON, or a thrown request → `verify` returns `false`.
- **No provider configured** → `createNoopCaptcha()` (dev pass-through). A provider selected but its secret unset in production = misconfiguration → reject + boot warning (never silent pass-through in prod).
- Providers v1: **Turnstile + reCAPTCHA v2** only. No v3, no other providers, no admin secret entry.
- TDD; conventional commits ending with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: `CaptchaPort` + `createNoopCaptcha` (core, interface only)

**Files:**
- Create: `packages/core/src/captcha/captcha-port.ts`
- Create: `packages/core/test/captcha/noop.test.ts`
- Modify: `packages/core/src/index.ts` (add exports)

**Interfaces:**
- Produces: `interface CaptchaPort { verify(token: string, remoteip?: string): Promise<boolean> }`; `createNoopCaptcha(): CaptchaPort`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/captcha/noop.test.ts
import { describe, it, expect } from 'vitest'
import { createNoopCaptcha } from '../../src/captcha/captcha-port'

describe('createNoopCaptcha', () => {
  it('accepts any token (dev/no-provider pass-through)', async () => {
    const c = createNoopCaptcha()
    expect(await c.verify('anything')).toBe(true)
    expect(await c.verify('')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/core test -- captcha/noop`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/core/src/captcha/captcha-port.ts
/** Provider-agnostic spam-protection verifier. Implementations live in adapter
 *  packages (@setu/captcha-turnstile, @setu/captcha-recaptcha). Always
 *  fail-closed: any error/non-success → false. */
export interface CaptchaPort {
  verify(token: string, remoteip?: string): Promise<boolean>
}

/** Dev / no-provider pass-through: accepts everything. Named explicitly so it is
 *  never mistaken for a real verifier. */
export function createNoopCaptcha(): CaptchaPort {
  return { async verify() { return true } }
}
```

Add to `packages/core/src/index.ts`:

```typescript
export type { CaptchaPort } from './captcha/captcha-port'
export { createNoopCaptcha } from './captcha/captcha-port'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/core test -- captcha/noop`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/captcha packages/core/test/captcha packages/core/src/index.ts
git commit -m "feat(core): CaptchaPort interface + createNoopCaptcha"
```

---

## Task 2: `@setu/captcha-turnstile` adapter + `runCaptchaPortContract` harness

**Files:**
- Modify: `packages/db-testing/src/index.ts` (add the contract harness)
- Create package: `packages/captcha-turnstile/` (`package.json`, `tsconfig.json`, `src/index.ts`, `test/contract.test.ts`)

**Interfaces:**
- Consumes: `CaptchaPort` (Task 1).
- Produces: `runCaptchaPortContract(makeAdapter: (fetchImpl: typeof fetch) => CaptchaPort): void`; `createTurnstileCaptcha(opts: { secret: string; fetchImpl?: typeof fetch }): CaptchaPort`.

- [ ] **Step 1: Add the shared contract harness**

Append to `packages/db-testing/src/index.ts`:

```typescript
import type { CaptchaPort } from '@setu/core'

/** Behavioral contract for any CaptchaPort adapter. `makeAdapter` builds the
 *  adapter with an injected fetch so the harness controls the provider response. */
export function runCaptchaPortContract(makeAdapter: (fetchImpl: typeof fetch) => CaptchaPort): void {
  const fakeFetch = (status: number, body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  describe('CaptchaPort contract', () => {
    it('returns true when the provider reports success', async () => {
      expect(await makeAdapter(fakeFetch(200, { success: true })).verify('tok')).toBe(true)
    })
    it('returns false when the provider reports failure', async () => {
      expect(await makeAdapter(fakeFetch(200, { success: false })).verify('tok')).toBe(false)
    })
    it('returns false on a non-OK HTTP status (fail-closed)', async () => {
      expect(await makeAdapter(fakeFetch(500, {})).verify('tok')).toBe(false)
    })
    it('returns false when the request throws (fail-closed)', async () => {
      const throwing = (() => Promise.reject(new Error('net'))) as unknown as typeof fetch
      expect(await makeAdapter(throwing).verify('tok')).toBe(false)
    })
  })
}
```

- [ ] **Step 2: Scaffold the package + failing test**

`packages/captcha-turnstile/package.json`:

```json
{
  "name": "@setu/captcha-turnstile",
  "version": "0.0.0",
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*" },
  "devDependencies": {
    "@setu/db-testing": "workspace:*",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

`packages/captcha-turnstile/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": [] }, "include": ["src", "test"] }
```

`packages/captcha-turnstile/test/contract.test.ts`:

```typescript
import { runCaptchaPortContract } from '@setu/db-testing'
import { createTurnstileCaptcha } from '../src/index'

runCaptchaPortContract((fetchImpl) => createTurnstileCaptcha({ secret: 'secret', fetchImpl }))
```

- [ ] **Step 3: Install + run (red)**

Run: `pnpm install && pnpm --filter @setu/captcha-turnstile test`
Expected: FAIL — `createTurnstileCaptcha` not found.

- [ ] **Step 4: Implement (the logic moved out of core)**

```typescript
// packages/captcha-turnstile/src/index.ts
import type { CaptchaPort } from '@setu/core'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Cloudflare Turnstile CaptchaPort. Fail-closed. `fetchImpl` injectable for tests. */
export function createTurnstileCaptcha(opts: { secret: string; fetchImpl?: typeof fetch }): CaptchaPort {
  const f = opts.fetchImpl ?? fetch
  return {
    async verify(token, remoteip) {
      try {
        const body = new URLSearchParams({ secret: opts.secret, response: token })
        if (remoteip) body.set('remoteip', remoteip)
        const res = await f(SITEVERIFY, { method: 'POST', body })
        if (!res.ok) return false
        const data = (await res.json()) as { success?: boolean }
        return data.success === true
      } catch {
        return false
      }
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @setu/captcha-turnstile test`
Expected: PASS (4 contract cases).

- [ ] **Step 6: Commit**

```bash
git add packages/db-testing/src/index.ts packages/captcha-turnstile
git commit -m "feat(captcha-turnstile): Turnstile CaptchaPort adapter + contract harness"
```

---

## Task 3: `@setu/captcha-recaptcha` adapter (reCAPTCHA v2)

**Files:**
- Create package: `packages/captcha-recaptcha/` (`package.json`, `tsconfig.json`, `src/index.ts`, `test/contract.test.ts`)

**Interfaces:**
- Consumes: `CaptchaPort` (Task 1), `runCaptchaPortContract` (Task 2).
- Produces: `createRecaptchaCaptcha(opts: { secret: string; fetchImpl?: typeof fetch }): CaptchaPort`.

- [ ] **Step 1: Scaffold + failing test**

`packages/captcha-recaptcha/package.json`:

```json
{
  "name": "@setu/captcha-recaptcha",
  "version": "0.0.0",
  "type": "module",
  "license": "AGPL-3.0-only",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@setu/core": "workspace:*" },
  "devDependencies": {
    "@setu/db-testing": "workspace:*",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

`packages/captcha-recaptcha/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": [] }, "include": ["src", "test"] }
```

`packages/captcha-recaptcha/test/contract.test.ts`:

```typescript
import { runCaptchaPortContract } from '@setu/db-testing'
import { createRecaptchaCaptcha } from '../src/index'

runCaptchaPortContract((fetchImpl) => createRecaptchaCaptcha({ secret: 'secret', fetchImpl }))
```

- [ ] **Step 2: Install + run (red)**

Run: `pnpm install && pnpm --filter @setu/captcha-recaptcha test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (reCAPTCHA v2 siteverify — same shape, different URL)**

```typescript
// packages/captcha-recaptcha/src/index.ts
import type { CaptchaPort } from '@setu/core'

const SITEVERIFY = 'https://www.google.com/recaptcha/api/siteverify'

/** Google reCAPTCHA v2 CaptchaPort. Fail-closed. `fetchImpl` injectable for tests. */
export function createRecaptchaCaptcha(opts: { secret: string; fetchImpl?: typeof fetch }): CaptchaPort {
  const f = opts.fetchImpl ?? fetch
  return {
    async verify(token, remoteip) {
      try {
        const body = new URLSearchParams({ secret: opts.secret, response: token })
        if (remoteip) body.set('remoteip', remoteip)
        const res = await f(SITEVERIFY, { method: 'POST', body })
        if (!res.ok) return false
        const data = (await res.json()) as { success?: boolean }
        return data.success === true
      } catch {
        return false
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/captcha-recaptcha test`
Expected: PASS (4 contract cases).

- [ ] **Step 5: Commit**

```bash
git add packages/captcha-recaptcha
git commit -m "feat(captcha-recaptcha): reCAPTCHA v2 CaptchaPort adapter"
```

---

## Task 4: Rewire core + API to the port (`captcha`/`captchaToken`); select adapter by env

**Files:**
- Modify: `packages/core/src/submissions/submission-service.ts`
- Modify: `packages/core/test/submissions/submission-service.test.ts`
- Modify: `packages/core/src/submissions/contact-form.ts`
- Modify: `packages/core/test/submissions/contact-form.test.ts`
- Delete: `packages/core/src/submissions/turnstile.ts`, `packages/core/test/submissions/turnstile.test.ts`
- Modify: `packages/core/src/index.ts` (remove turnstile exports)
- Modify: `apps/api/src/forms.ts`, `apps/api/test/forms.test.ts`
- Modify: `apps/api/src/server.ts`, `apps/api/package.json` (add captcha adapter deps)

**Interfaces:**
- Consumes: `CaptchaPort` (Task 1), `createTurnstileCaptcha` (Task 2), `createRecaptchaCaptcha` (Task 3), `createNoopCaptcha` (Task 1).
- Produces: `SubmissionServiceDeps.captcha: CaptchaPort`; `SubmitInput.captchaToken: string`; `submitContact(opts.captchaToken)`; `/forms/submit` body field `captchaToken`.

- [ ] **Step 1: Update the service tests first (red)**

In `packages/core/test/submissions/submission-service.test.ts`, replace every `verifyTurnstile: <fn>` dep with `captcha: { verify: <fn> }`, and every `turnstileToken` input field with `captchaToken`. Concretely: a passing stub becomes `captcha: { verify: async () => true }`; the spam case `captcha: { verify: async () => false }`; the base input uses `captchaToken: 'tok'`. In `packages/core/test/submissions/contact-form.test.ts`, rename the `turnstileToken` argument to `captchaToken` and assert the POST body contains `captchaToken`. In `apps/api/test/forms.test.ts`, change the request bodies from `turnstileToken` to `captchaToken`.

Run: `pnpm --filter @setu/core test -- submission-service contact-form && pnpm --filter @setu/api test -- forms`
Expected: FAIL (deps/fields renamed; implementation not yet changed).

- [ ] **Step 2: Refactor `submission-service.ts`**

Change the import, `SubmitInput`, `SubmissionServiceDeps`, the destructure, and the verify call:

```typescript
// top of file: replace the turnstile import
import type { CaptchaPort } from '../captcha/captcha-port'
```

```typescript
// SubmitInput: rename the token field
export interface SubmitInput {
  formId: string
  formLabel?: string
  fields: Record<string, string>
  captchaToken: string
  honeypot?: string
  source?: Submission['source']
  ip?: string
}
```

```typescript
// SubmissionServiceDeps: replace verifyTurnstile with the port
export interface SubmissionServiceDeps {
  submissions: SubmissionPort
  captcha: CaptchaPort
  email?: EmailPort
  notifyTo?: string
  notifyFrom?: string
  renderNotification?: (submission: Submission) => NotificationContent | Promise<NotificationContent>
}
```

```typescript
// in createSubmissionService: destructure captcha, and the verify step
  const { submissions, captcha, email, notifyTo, notifyFrom } = deps
  // ...
      // 2. Captcha (fails closed inside the adapter).
      if (!(await captcha.verify(input.captchaToken, input.ip))) return { ok: false, error: 'spam' }
```

- [ ] **Step 3: Refactor `contact-form.ts`**

In `submitContact`, rename the option + the body field:

```typescript
// the opts type field: turnstileToken -> captchaToken
// and in the JSON body:
        captchaToken: opts.captchaToken,
```

(Find the `turnstileToken: string` option field and the `turnstileToken: opts.turnstileToken` body line; rename both to `captchaToken`.)

- [ ] **Step 4: Delete the in-core Turnstile + its exports**

```bash
git rm packages/core/src/submissions/turnstile.ts packages/core/test/submissions/turnstile.test.ts
```

In `packages/core/src/index.ts`, remove the two lines:

```typescript
export { createTurnstileVerifier } from './submissions/turnstile'
export type { TurnstileVerifier } from './submissions/turnstile'
```

- [ ] **Step 5: Refactor `apps/api/src/forms.ts`**

Rename the body field in the `POST /forms/submit` handler (3 spots): the body type `turnstileToken?: string` → `captchaToken?: string`; the validation `typeof body.turnstileToken !== 'string'` → `typeof body.captchaToken !== 'string'`; the submit call `turnstileToken: body.turnstileToken` → `captchaToken: body.captchaToken`.

- [ ] **Step 6: Rewire `apps/api/src/server.ts` to select an adapter by env**

Add deps to `apps/api/package.json`: `"@setu/captcha-turnstile": "workspace:*"`, `"@setu/captcha-recaptcha": "workspace:*"`; then `pnpm install`.

Replace the import line `import { createSubmissionService, createTurnstileVerifier } from '@setu/core'` with:

```typescript
import { createSubmissionService, createNoopCaptcha } from '@setu/core'
import { createTurnstileCaptcha } from '@setu/captcha-turnstile'
import { createRecaptchaCaptcha } from '@setu/captcha-recaptcha'
```

Replace the Turnstile wiring block (the `const turnstileSecret = ...` through the `verifyTurnstile = ...` ternary) with:

```typescript
// Spam protection: select a captcha adapter by env. Secret is env-only.
const captchaProvider = process.env.SETU_CAPTCHA_PROVIDER ?? '' // 'turnstile' | 'recaptcha' | ''
const captchaSecret =
  captchaProvider === 'recaptcha'
    ? (process.env.SETU_RECAPTCHA_SECRET ?? '')
    : (process.env.SETU_TURNSTILE_SECRET ?? '')
const captcha = resolveCaptcha(captchaProvider, captchaSecret)
```

And add this helper near the top of the file (after the imports):

```typescript
import type { CaptchaPort } from '@setu/core'

function resolveCaptcha(provider: string, secret: string): CaptchaPort {
  if (!provider) return createNoopCaptcha() // no provider configured → dev pass-through
  if (!secret) {
    // Provider selected but secret missing.
    if (process.env.NODE_ENV === 'production') {
      console.error(`[captcha] provider "${provider}" selected but its secret is unset — rejecting submissions`)
      return { async verify() { return false } } // fail-closed in prod
    }
    console.warn(`[captcha] provider "${provider}" selected but secret unset — dev pass-through`)
    return createNoopCaptcha()
  }
  return provider === 'recaptcha'
    ? createRecaptchaCaptcha({ secret })
    : createTurnstileCaptcha({ secret })
}
```

Then in the `createSubmissionService({ ... })` call, replace `verifyTurnstile,` with `captcha,`.

- [ ] **Step 7: Run all affected tests + workspace typecheck (green)**

Run: `pnpm --filter @setu/core test -- submission-service contact-form`
Run: `pnpm --filter @setu/api test -- forms`
Run: `pnpm -r typecheck`
Expected: PASS (the pre-existing `apps/site` `astro:content` failure is known/unrelated; everything else clean).

- [ ] **Step 8: Commit**

```bash
git add packages/core apps/api
git commit -m "refactor(forms): submit via CaptchaPort + captchaToken; select adapter by env"
```

---

## Task 5: Provider-agnostic client widget (`mountCaptcha`)

**Files:**
- Create: `packages/blocks/src/contact/mount-captcha.ts`
- Create: `packages/blocks/test/mount-captcha.test.ts` (add a `test/` dir if absent; ensure `@setu/blocks` has a `test` script — it does)
- Modify: `packages/blocks/src/contact/ContactForm.tsx`
- Modify: `blocks/contact/contact.astro`
- Modify: `apps/site/.env.example`

**Interfaces:**
- Produces: `type CaptchaProvider = 'turnstile' | 'recaptcha'`; `captchaScriptUrl(provider): string`; `mountCaptcha(opts): { reset: () => void }`.
- Consumes: `ContactForm` gains a `provider: CaptchaProvider` prop.

- [ ] **Step 1: Write the failing test (pure part)**

```typescript
// packages/blocks/test/mount-captcha.test.ts
import { describe, it, expect } from 'vitest'
import { captchaScriptUrl } from '../src/contact/mount-captcha'

describe('captchaScriptUrl', () => {
  it('returns the Turnstile explicit-render script', () => {
    expect(captchaScriptUrl('turnstile')).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    )
  })
  it('returns the reCAPTCHA explicit-render script', () => {
    expect(captchaScriptUrl('recaptcha')).toBe('https://www.google.com/recaptcha/api.js?render=explicit')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/blocks test -- mount-captcha`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mount-captcha.ts`**

```typescript
// packages/blocks/src/contact/mount-captcha.ts
export type CaptchaProvider = 'turnstile' | 'recaptcha'

export function captchaScriptUrl(provider: CaptchaProvider): string {
  return provider === 'recaptcha'
    ? 'https://www.google.com/recaptcha/api.js?render=explicit'
    : 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
}

interface WidgetApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
    },
  ) => string
  reset: (id?: string) => void
}

const getWidgetApi = (provider: CaptchaProvider): WidgetApi | undefined => {
  const w = window as unknown as { turnstile?: WidgetApi; grecaptcha?: WidgetApi }
  const api = provider === 'recaptcha' ? w.grecaptcha : w.turnstile
  return api && typeof api.render === 'function' ? api : undefined
}

const injected = new Set<CaptchaProvider>()
function ensureScript(provider: CaptchaProvider): void {
  if (injected.has(provider)) return
  injected.add(provider)
  const s = document.createElement('script')
  s.src = captchaScriptUrl(provider)
  s.async = true
  s.defer = true
  document.head.appendChild(s)
}

/** Inject the provider's script (once), render its widget into `el`, and call
 *  onToken when solved. Returns a reset() handle. Provider-agnostic over
 *  Turnstile + reCAPTCHA v2 (both expose a `.render(el, opts)` global). */
export function mountCaptcha(opts: {
  provider: CaptchaProvider
  siteKey: string
  el: HTMLElement
  onToken: (token: string) => void
}): { reset: () => void } {
  const { provider, siteKey, el, onToken } = opts
  ensureScript(provider)
  let widgetId: string | null = null
  let cancelled = false
  let tries = 0
  const tryRender = (): boolean => {
    if (cancelled || widgetId !== null) return true
    const api = getWidgetApi(provider)
    if (!api) return false
    widgetId = api.render(el, {
      sitekey: siteKey,
      callback: (t) => onToken(t),
      'expired-callback': () => onToken(''),
      'error-callback': () => onToken(''),
    })
    return true
  }
  if (!tryRender()) {
    const interval = setInterval(() => {
      tries++
      if (tryRender() || tries > 100) clearInterval(interval) // give up after ~20s
    }, 200)
  }
  return {
    reset() {
      const api = getWidgetApi(provider)
      if (api && widgetId !== null) api.reset(widgetId)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @setu/blocks test -- mount-captcha`
Expected: PASS.

- [ ] **Step 5: Rewire `ContactForm.tsx` to use `mountCaptcha`**

In `packages/blocks/src/contact/ContactForm.tsx`:
1. Add the import: `import { mountCaptcha, type CaptchaProvider } from './mount-captcha'`.
2. Add `provider: CaptchaProvider` to `ContactFormProps` and destructure it from props.
3. Delete the `TurnstileApi` interface and the `getTurnstile` helper (lines around the top).
4. Replace the Turnstile `useEffect` (the whole block that calls `getTurnstile()`/`ts.render`) with:

```tsx
  const captchaRef = useRef<{ reset: () => void } | null>(null)
  useEffect(() => {
    if (!siteKey || !widgetRef.current || captchaRef.current) return
    captchaRef.current = mountCaptcha({ provider, siteKey, el: widgetRef.current, onToken: setToken })
  }, [provider, siteKey])
```

5. Make the token requirement conditional on a configured provider (so keyless dev still submits). In `onSubmit`, change the token guard to:

```tsx
    if (siteKey && token === '') {
      // A provider is configured but the widget hasn't produced a token yet.
      setStatus('error')
      return
    }
```

6. On submit failure, reset via the handle: replace the Turnstile-reset block with:

```tsx
      setStatus('error')
      captchaRef.current?.reset()
      setToken('')
```

(`widgetRef`, `token`, `setToken` stay. `widgetId` ref is removed — `mountCaptcha` owns it.)

- [ ] **Step 6: Rewire `contact.astro` (provider from config; island injects the script)**

Replace the frontmatter site-key line + the `<ContactForm .../>` props + remove the hardcoded Turnstile `<script>`:

```astro
const provider = (import.meta.env.PUBLIC_CAPTCHA_PROVIDER ?? 'turnstile') as 'turnstile' | 'recaptcha'
const siteKey = import.meta.env.PUBLIC_CAPTCHA_SITE_KEY ?? ''
```

Pass `provider={provider} siteKey={siteKey}` to `<ContactForm client:load ... />`, and **delete** the line:

```astro
<script is:inline src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
```

(The island now injects the correct provider script via `mountCaptcha`.)

- [ ] **Step 7: Update `apps/site/.env.example`**

Replace the Turnstile-specific public var with the provider-agnostic ones:

```
# Spam protection provider for forms: turnstile | recaptcha (unset = no captcha in dev)
PUBLIC_CAPTCHA_PROVIDER=turnstile
# The provider's PUBLIC site key (safe to expose; rendered in the page).
# Turnstile always-pass test key shown; use your real key in production.
PUBLIC_CAPTCHA_SITE_KEY=1x00000000000000000000AA
```

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm --filter @setu/blocks typecheck`

```bash
git add packages/blocks blocks/contact/contact.astro apps/site/.env.example
git commit -m "feat(blocks): provider-agnostic captcha widget (mountCaptcha)"
```

---

## Task 6: Admin read-only "configured" status

**Files:**
- Modify: `apps/api/src/forms.ts` (add `GET /forms/captcha-status`)
- Modify: `apps/api/test/forms.test.ts` (test the status route)
- Modify: `apps/api/src/server.ts` (pass the env-derived status into `createFormsApi`)
- Modify: the admin Settings screen (locate it — likely `apps/admin/src/screens/Settings.tsx` or a `Placeholder` routed at `/settings`) to add a "Spam protection" status card.

**Interfaces:**
- Consumes: nothing new.
- Produces: `createFormsApi(opts)` gains `captchaStatus?: { provider: string; secretConfigured: boolean }`; `GET /forms/captcha-status` → `{ provider: string; secretConfigured: boolean }`.

- [ ] **Step 1: Write the failing API test**

Add to `apps/api/test/forms.test.ts`:

```typescript
  it('GET /forms/captcha-status returns provider + secretConfigured booleans', async () => {
    const submissions = createMemorySubmissionPort()
    const submit = createSubmissionService({ submissions, captcha: { verify: async () => true } })
    const app = createFormsApi({ submit, submissions, captchaStatus: { provider: 'turnstile', secretConfigured: true } })
    const res = await app.fetch(new Request('http://x/forms/captcha-status'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ provider: 'turnstile', secretConfigured: true })
  })

  it('GET /forms/captcha-status defaults to none when no status is supplied', async () => {
    const submissions = createMemorySubmissionPort()
    const submit = createSubmissionService({ submissions, captcha: { verify: async () => true } })
    const app = createFormsApi({ submit, submissions })
    expect(await (await app.fetch(new Request('http://x/forms/captcha-status'))).json()).toEqual({
      provider: '',
      secretConfigured: false,
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @setu/api test -- forms`
Expected: FAIL — route not found (404) / `captchaStatus` not an option.

- [ ] **Step 3: Add the option + route to `createFormsApi`**

In `apps/api/src/forms.ts`, extend the options type and add the route (place it with the other `GET` routes):

```typescript
export function createFormsApi(opts: {
  submit: SubmissionService
  submissions: SubmissionPort
  captchaStatus?: { provider: string; secretConfigured: boolean }
}): Hono {
  const { submit, submissions } = opts
  const captchaStatus = opts.captchaStatus ?? { provider: '', secretConfigured: false }
  // ...existing app setup...

  app.get('/forms/captcha-status', (c) => c.json(captchaStatus))
```

(Returns booleans only — the secret value is never read or returned here.)

- [ ] **Step 4: Wire the status from env in `server.ts`**

In `apps/api/src/server.ts`, compute the status next to the captcha wiring and pass it into `createFormsApi`:

```typescript
const captchaStatus = { provider: captchaProvider, secretConfigured: captchaSecret !== '' }
// ...
app.route('/', createFormsApi({ submit, submissions, captchaStatus }))
```

- [ ] **Step 5: Run API tests (green)**

Run: `pnpm --filter @setu/api test -- forms`
Expected: PASS.

- [ ] **Step 6: Add the admin status card**

Locate the Settings screen (grep `apps/admin/src` for the `/settings` route in `app.tsx`; it likely renders `<Placeholder title="Settings" />`). Add a small **Spam protection** card that fetches `GET {apiBase}/forms/captcha-status` (the API base is the same `VITE_SETU_API` the app already uses — read it the way other admin code does, e.g. `import.meta.env.VITE_SETU_API`) and renders one of:
- no provider: "Spam protection: not configured" (muted).
- provider set + `secretConfigured`: "Spam protection: **{provider}** — secret detected ✓".
- provider set + not configured: "Spam protection: **{provider}** — secret missing ⚠ (set `SETU_{PROVIDER}_SECRET`)".

Minimal component (adapt imports/paths to the real Settings screen + the app's `apiBase` source):

```tsx
function SpamProtectionStatus({ apiBase }: { apiBase: string }) {
  const [status, setStatus] = useState<{ provider: string; secretConfigured: boolean } | null>(null)
  useEffect(() => {
    void fetch(`${apiBase}/forms/captcha-status`)
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ provider: '', secretConfigured: false }))
  }, [apiBase])
  if (!status) return null
  const label = !status.provider
    ? 'Spam protection: not configured'
    : status.secretConfigured
      ? `Spam protection: ${status.provider} — secret detected ✓`
      : `Spam protection: ${status.provider} — secret missing ⚠`
  return <p className="text-sm text-muted-foreground">{label}</p>
}
```

(It only ever reads booleans + the provider name — never a secret. Keys are set as env vars at the host; the admin never accepts or stores them.)

- [ ] **Step 7: Typecheck + UAT**

Run: `pnpm --filter @setu/admin typecheck`
UAT: with `SETU_CAPTCHA_PROVIDER=turnstile` + `SETU_TURNSTILE_SECRET=...` set on the API, the admin Settings shows "secret detected ✓"; unset the secret → "secret missing ⚠"; unset the provider → "not configured". Submit a form on the site with `PUBLIC_CAPTCHA_PROVIDER`/`PUBLIC_CAPTCHA_SITE_KEY` set and confirm the widget renders + the submission lands.

- [ ] **Step 8: Commit**

```bash
git add apps/api apps/admin
git commit -m "feat(admin): read-only spam-protection status (no secret entry)"
```

**Final:** request a whole-branch review (`superpowers:requesting-code-review`), then `superpowers:finishing-a-development-branch`.

---

## Self-Review (author checklist — completed)

**1. Spec coverage:**
- `CaptchaPort` in core (interface only) + `createNoopCaptcha` → Task 1. ✅
- Provider adapter packages `captcha-turnstile` (extracted) + `captcha-recaptcha` v2 → Tasks 2, 3. ✅
- Shared `runCaptchaPortContract` → Task 2. ✅
- Core no longer holds Turnstile; service/contact/api use the port + `captchaToken` → Task 4. ✅
- Adapter selected by env; secret env-only; no-provider dev pass-through; prod misconfig → reject → Task 4 (`resolveCaptcha`). ✅
- Provider-agnostic client widget; script injected by island; provider+site key from `PUBLIC_*` → Task 5. ✅
- Secret keys env-only, never DB/Git/admin-UI; admin read-only "configured" status (booleans only) → Tasks 4 + 6. ✅
- No change to submission storage / inbox / email → none of the tasks touch those. ✅

**2. Placeholder scan:** No TBD/TODO; code steps carry complete code. The admin Settings touch-point (Task 6 Step 6) names the grep target + exact endpoint + a concrete component, with the apiBase source matched to existing admin code (the one spot that depends on a file this plan doesn't fully reproduce).

**3. Type consistency:** `CaptchaPort.verify(token, remoteip?)`, `createNoopCaptcha`, `createTurnstileCaptcha`/`createRecaptchaCaptcha({ secret, fetchImpl? })`, `runCaptchaPortContract((fetchImpl) => CaptchaPort)`, `captcha`/`captchaToken`, `CaptchaProvider`, `mountCaptcha`, and `captchaStatus: { provider, secretConfigured }` are consistent across Tasks 1–6.

**Open questions resolved:** O1 → `mountCaptcha` switch in `@setu/blocks` (flat island deps). O2 → `PUBLIC_CAPTCHA_PROVIDER` + single `PUBLIC_CAPTCHA_SITE_KEY`. O3 → status route on the forms API (`GET /forms/captcha-status`). O4 → prod misconfig **rejects** (fail-closed); dev passes through.
