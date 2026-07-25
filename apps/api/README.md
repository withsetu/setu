# @setu/api — local git API

Exposes the GitPort (git-local) over HTTP so the in-browser admin can commit to the real repo.

## Run everything (api + admin + site)
From the repo root:

    pnpm dev

- api:   http://localhost:4444  (env: SETU_API_PORT, SETU_REPO_DIR)
- admin: http://localhost:5173  (env: VITE_SETU_API → the api URL)
- site:  http://localhost:4321

With the admin pointed at the api (VITE_SETU_API), **Publish** commits the real
`.mdoc` into repo-root `content/` and the site renders it. Without VITE_SETU_API the
admin runs fully in-browser (no server). Local-only; the api has no auth.

Note: git-local needs a normal git checkout — it does not follow a git *worktree's*
`.git` pointer file, so run `pnpm dev` from a normal clone (SETU_REPO_DIR), not a worktree.

## Captcha in dev — Turnstile test keys (#868)

Captcha is OFF by default in dev. To drive the real widget (login card, forgot-password card)
without a domain or a Cloudflare account, prefix `pnpm dev` with Cloudflare's permanent public
Turnstile test pair — documentation values, not secrets
([developers.cloudflare.com/turnstile/troubleshooting/testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)):

    SETU_CAPTCHA_PROVIDER=turnstile \
    SETU_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
    SETU_TURNSTILE_SECRET=1x0000000000000000000000000000000AA \
    pnpm dev

The widget renders, auto-passes, and the api verifies the dummy token at the real siteverify
endpoint. Other documented dummies: sitekey `3x00000000000000000000FF` forces the interactive
challenge; secret `2x0000000000000000000000000000000AA` makes siteverify reject every token
(exercise the visible-error path); `3x0000000000000000000000000000000AA` yields "token already
spent" (the single-use re-arm path). The full key detection list lives in
`apps/api/src/captcha-test-keys.ts`.

**These keys protect nothing** — every challenge auto-resolves. The api's `[captcha]` boot line
prints a loud `TEST KEYS` warning whenever one is configured; if you see it on a production
deployment, rotate to real keys immediately. The e2e captcha lane (`pnpm e2e:captcha`,
`e2e/captcha.config.ts`) uses the same pairs.

The forgot-password card additionally needs `email.deliverable` (a real transport:
`SETU_EMAIL_ADAPTER=resend` + `RESEND_API_KEY` + `SETU_FORMS_NOTIFY_FROM`) to show its form —
without it the card honestly reports reset isn't configured, captcha or not.
