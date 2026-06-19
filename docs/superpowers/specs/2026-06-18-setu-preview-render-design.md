# In-editor preview — Slice 1: render a draft through the real theme

**Date:** 2026-06-18
**Status:** approved (owner)
**Closes:** render/theme sub-project #5 (first slice). Builds on the Local Bridge + theme layer.

## Goal

A **"Preview"** action in the editor renders the **current draft** (unsaved edits included) through
the **real theme + Markdoc component pipeline** — byte-for-byte what publishing would produce — and
opens it in a new browser tab. Slice 2 will embed it as a live panel.

## Verified before designing (per the standing rules)

- **Docs + spike (rule #1):** Astro Live Content Collections render only a loader-provided
  `rendered.html` string — they would **lose our custom components**. The faithful path is
  `createContentComponent` from **`@astrojs/markdoc/runtime`** (the exact function the build
  generates), which a spike confirmed renders an arbitrary Markdoc string through our real
  components (callout, paragraph, checklist `item` transform) on demand — **zero drift**. Uses
  `@astrojs/markdoc`'s exported `./runtime` + `./components` + `./runtime-assets-config` subpaths
  (semi-public; the build depends on them; stable within a major → pin `@astrojs/markdoc`, re-verify
  on upgrade).
- **Cloudflare + cost (rule #2):** the published site stays **100% static** (zero per-visitor
  function cost). Preview is the **only** on-demand surface, and it's **dev-only in Slice 1** (see
  below) — never built into production. The edge/production preview (a Cloudflare Pages Function via
  the Cloudflare adapter) is **deferred to the edge topology**; that's where we confirm the adapter
  renders this runtime path. Either way preview is editor-only + debounced + one render per request
  → bounded, no bill risk.

## Architecture

Three small units; services/round-trip untouched.

### 1. Producer — a preview slot on the Hono api (`apps/api`)

`apps/api/src/preview.ts` → `createPreviewApi(): Hono` over a single in-memory slot:
- `POST /preview` — store `{ content, collection, locale, slug }` (the compiled `.mdoc` + ref).
- `GET /preview` — return the stored draft, or `404` when empty.
- `cors()` (the admin POSTs cross-origin; the site fetches server-side). `server.ts` mounts it
  alongside the git api on the same listener.
- **Single slot** = the one draft being previewed (single-user dev). Documented; key-by-ref later.

### 2. Render — a dev-only preview route (`apps/site`)

- **`apps/site/src/preview/preview.astro`** (NOT under `pages/`, so it's never in the static build):
  fetches `GET ${SETU_API_URL}/preview` (default `http://localhost:4444`), `parseMdoc` the `.mdoc`
  → `{ frontmatter, body }`, builds `Content` via `createContentComponent` (the spike recipe:
  `Renderer` + the tag/node component maps + `markdoc.config.mjs` + `assetsConfig`), and renders it
  inside the **real theme layout** (`@theme/PostLayout.astro` or `PageLayout.astro` by collection)
  with the title from frontmatter + `loadThemeOptions()`. Empty slot → a friendly "Nothing to
  preview yet" page.
- **Injected only in dev:** an inline integration in `astro.config.mjs` calls `injectRoute` for
  `/preview` **only when `command === 'dev'`**. So `astro build` (and the 30 render tests) never see
  it → the static build is completely unaffected; preview works under `astro dev` (`pnpm dev`), which
  serves on-demand routes with no adapter. (Production/edge preview = the deferred edge item.)

### 3. Editor "Preview" button (`apps/admin`)

- A `Preview` button (eye icon) in the editor strip, enabled in **bridge mode** (`VITE_SETU_API`
  set) and when not composing. On click: compile the **current in-memory draft** —
  `serializeMdoc({ frontmatter: metaRef.current, body: tiptapToMarkdoc(docRef.current) })` (the same
  serialization publish uses) — `POST` it to `${VITE_SETU_API}/preview`, then open/refresh a named
  preview tab at `${siteUrl()}/preview` (reuses `siteUrl` from the View-Site feature). A retained
  window ref is reloaded on repeat clicks so the tab always shows the latest.
- Disabled (with a tooltip) in pure in-browser mode (no api) — same limitation as publish-to-site.

### Dev wiring

`pnpm dev` site command gains `SETU_API_URL=http://localhost:4444` (explicit; the route also
defaults to it).

## Testing

- **api:** `POST /preview` then `GET /preview` returns the stored draft; empty slot → 404; CORS
  header present. (Mirrors `app.test.ts` via `app.fetch`.)
- **admin:** the Preview button — disabled without `VITE_SETU_API`; on click compiles the current
  draft and POSTs the expected `.mdoc` to `${api}/preview` and opens `${site}/preview` (mock
  `fetch` + `window.open`).
- **render route:** dev-only + Astro-runtime-bound, so it's **not** unit-tested in the static
  harness. It's **spike-proven** and verified by a scripted `pnpm dev` smoke (POST a draft → fetch
  `/preview` → assert the callout/checklist HTML), documented in the verification step. The 30
  existing render tests must stay **green and unchanged** (proves the dev-only injection didn't touch
  the build).

## Out of scope (Slice 2 / later)

- **Embedded live preview panel** in the editor (iframe, updates as you type) — Slice 2.
- Production/edge preview (Cloudflare adapter Pages Function) — with the edge topology.
- Per-entry preview slots / multi-tab; previewing pending **Customizer** theme-option values.
