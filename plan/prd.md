# 🏗️ Product Requirement Document (PRD)

## Project Name: Saytu (Digital Experience Builder with an ultimate Developer Experience)

**Vision (from developer angle):** A 100% open-source, Git-backed, multi-topology content management engine. Saytu acts as the "bridge" (Sanskrit: *Setu*) between a developer's preferred authoring environment and a hyper-fast production edge. It pairs a headless Tiptap editor with Astro 6's modern Rust-based toolchain, using a strict Hexagonal (Ports & Adapters) Architecture to decouple the CMS from any specific hosting provider.

### **Vision for business/marketing**

To empower marketing and business teams with absolute creative and operational autonomy over their digital presence, while completely eliminating the infrastructure overhead, soaring licensing fees, and persistent developer bottlenecks inherent in traditional enterprise content platforms.

### **Mission**

Saytu DXP bridges the gap between marketing velocity and engineering excellence. By providing an intuitive, friction-free visual editing experience for non-technical content creators and a zero-maintenance, hyper-fast edge architecture for developers, we enable organizations to maximize their digital ROI, secure flawless SEO performance, and maintain 100% ownership of their data without vendor lock-in.

---

### **Core Business Pillars**

* **Marketing Autonomy, Zero Bottlenecks:** Marketers can design, edit, and publish rich, component-driven layouts visually without waiting on engineering deployment cycles.
* **Drastically Lower TCO (Total Cost of Ownership):** Eliminates expensive enterprise seat-licenses and high cloud-compute bills by running serverless at the edge or on cost-effective infrastructure.
* **Performance-Driven ROI:** Built on a "Zero-JS by default" architecture to guarantee maximum site speed, directly boosting Google Lighthouse scores, organic search traffic, and conversion rates.

---

## 1. Architectural Core: Hexagonal "Ports & Adapters"

Saytu's core logic never hardcodes its environment. The system relies on abstract interfaces ("ports"); concrete implementations ("adapters") are selected per topology. This prevents vendor lock-in and lets the CMS morph across deployment topologies via plugins/addons.

* **The Core (`@saytu/core`):** Pure TypeScript logic. Handles Tiptap JSON ↔ Markdoc AST conversion, content-model/schema validation, draft/lock orchestration, the publish pipeline, redirect generation, and Git commit generation.
* **`DataPort` (Database):** The DB is **not** the source of truth for published content (see §2) — it is a derived index/cache plus the live store for drafts, locks, users/roles, and UGC (form submissions). Surface: content index (`db.get()`, `db.query()`, FTS5 search), drafts, locks, plus identity & submissions owned by the auth library and form handler.
* **`StoragePort` (Media):** `storage.signUpload()`, `storage.delete()`, `storage.signUrl()`.
* **`ImagePort` (Optimization):** pluggable image transform/optimization (see §11). Default is build-time sharp; runtime adapters for SSR.
* **`AuthPort` (Identity):** Resolve an authenticated request to `{ email, role }`. Auth mechanism is pluggable (§17); authorization always lives in the app.
* **`EmailPort` (Notifications):** `email.send()` over a pluggable transport (SMTP or HTTP API). Optional but expected (§14).
* **`GitPort` (edge-only seam):** Server topologies (T1/T3) use real `git` and are provider-agnostic for free. Only **edge** needs an HTTP commit/read API; `GitPort` abstracts that. **V1 ships GitHub only**; GitLab/Gitea are future adapters.

## 2. Source of Truth & Data Flow (Git-Canonical)

**Git is the single source of truth for published content. The database is a derived index/cache.**

* **Content vs. Code separation (load-bearing):**
  * **Developers edit code** — components (`*.astro`, framework components), `saytu.config.ts`, themes — in their own environment, pushed to Git.
  * **Marketers edit content** — `*.mdoc` (Markdoc) files + metadata, always through the Saytu admin.
  * These file-sets must not overlap.
* **The derived DB index:** On boot and on every Git change, Saytu parses published content into the database for fast SSR/admin/search reads. The index is disposable and rebuildable from Git at any time.
* **The publish flow (the only writer of content to Git):**
  1. Live edits save continuously to the DB as a **draft** (never to Git).
  2. On **Publish**, the draft compiles to a Markdoc file and is committed to Git ("Staged" — §16).
  3. The derived index updates; cache is purged (§16).
  4. **Local Git is fine** — a remote is optional. On **Edge**, Git writes go through `GitPort` (GitHub API; workerd has no native Git), so edge publishing is online-only.
* **External Git changes (rare but real):** Each draft records the **base Git SHA** it forked from; on Publish, if `HEAD` moved for that file, Saytu blocks the commit ("This file changed in Git — reload before publishing"). A **Git → DB re-index** hook keeps the index fresh. V1 does **not** build a real-time bidirectional sync engine.
* **Schema migrations:** `DataPort` schema is managed with **Drizzle + Drizzle Kit**. Key simplification — only **canonical** tables (users, submissions) need careful migrations; **derived** tables (index, FTS5) can be dropped and rebuilt from Git on schema change ("bump version → reindex"). Breaking `saytu.config.ts` changes ship a `saytu migrate` codemod.

## 3. Content Model: Collections, Fields & Taxonomies

Content is organized into typed **collections**, mirroring WordPress defaults so refugees feel at home.

* **Default collections (core, free):**
  * **`post`** — dated, taxonomy-enabled (categories + tags), appears in feeds.
  * **`page`** — hierarchical (parent/child, menu order), standalone, no taxonomy.
* **Field schema (Zod) per collection:** standard fields (title, slug, excerpt, featuredImage, author, date, status) + custom fields. **Author** is a relation to the users table. Body content is Markdoc blocks (§7); metadata is the field schema, edited in the editor sidebar.
* **Entry identity:** `(collection, locale, slug)`. **Locale** is a first-class dimension (§6). **Site is *not* a dimension** — one repo = one site (§15 multi-site is a separate SaaS layer).
* **Custom content types & custom fields:** the *capability* lives in **core** (a developer defines new types/fields as code in `saytu.config.ts`). The **visual type/field builder in the admin GUI is Pro** (the WordPress + ACF precedent: schema capability free, no-code builder paid).

## 4. URLs, Permalinks & Redirects

* **Clean, path-based URLs are the convention** (no meaningful query strings — see §18). E.g. `/blog/page/2`, never `?page=2`.
* **Permalink structure is per-collection**, WordPress-style patterns (`/%postname%/`, `/blog/%year%/%monthnum%/%postname%/`; hierarchical for pages). Defined in code (core) for any type; **editable in admin Settings for the default post/page types (free)**; permalink GUI for **custom** types is Pro.
* **Redirects (the thing WordPress gets wrong):** changing a slug or permalink structure **auto-generates 301s** for all affected entries. Redirects are stored in the DB and serialized to a manifest the build/edge consumes. **Automatic redirect-on-change is free**; the redirect *manager* UI (manual/bulk/import) is Pro (SEO plugin, §5).

## 5. SEO

The "flawless SEO" pillar requires the basics to be free and credible (the Yoast split).

* **Free (must-have):** per-entry **meta title + description**, canonical URL, OG/Twitter image, **`sitemap.xml`**, **`robots.txt`**, **automatic 301 on slug change** (§4), and **hreflang** (§6).
* **Pro (SEO plugin):** JSON-LD structured-data builder, redirect *manager* UI, readability/SEO scoring, social-card customization, bulk meta editing, internal-link suggestions.
* **Principle:** the capability to *not destroy* SEO is free; the productivity tooling around SEO is paid.

## 6. Internationalization (i18n)

Split along the open-core line so single-locale users pay zero complexity tax.

* **Structural (core, free, V1):** **locale as a first-class dimension** of entry identity (`(collection, locale, slug)`); locale-prefixed routing (`/fr/about`); **hreflang** generation; and **admin-UI localization** via community-maintained string catalogs. This is the non-revertible decision — it must be designed in from day one, never bolted on.
* **Translation management (Pro):** linking translations across locales, stale-translation detection, side-by-side editing, fallback chains, per-locale publish/lock. Precedent: WPML/Weglot are paid.

## 7. Content Syntax & Markdoc Fidelity

* **Syntax:** **Stripe Markdoc**, stored as `*.mdoc`. (Not Sätteri — Markdoc has its own parser/renderer and is not a remark/rehype plugin. Astro 6.4's pluggable Markdown pipeline stays available but unused for content in V1.)
* **Round-trip fidelity — never drop content.** Tiptap defines a generic **`markdocPassthrough` node** storing any AST subtree it has no first-class UI for as an opaque, read-only chip, **re-serialized verbatim on save**. Structural guarantee, not a promise.
* **Normal blocks (fully editable):** custom Markdoc tags with *static* attributes (`{% callout %}`, `{% hero %}`) → Tiptap nodes with prop sidebars.
* **Advanced / dynamic Markdoc (Pro):** variables (`{% $user.x %}`), conditionals, loops, functions/flags, partials → rendered via `markdocPassthrough` (preserved, not visually editable free). Generally **requires SSR** (build-known variables like `{% $site.title %}` can stay SSG).

## 8. The Theme API: The Single Source of Truth

The relationship between the Headless Editor (Tiptap), Content Syntax (Markdoc), and Frontend Rendering (Astro) is governed by `saytu.config.ts`.

* Developers define content blocks, expected props, Zod schemas, **collections (§3)**, and **permalink patterns (§4)** here.
* The Tiptap Editor reads it to generate slash-menu commands, block UI, and prop sidebars; the Markdoc parser reads it to validate the AST; the Astro frontend reads it to map AST nodes to components.
* **Child Theming & Component Overrides:** configuration-based overriding, not folder-based child themes. Install a base theme (`import baseTheme from '@saytu/theme-minimal'`), then override specific components in local config (e.g. map `Callout` → `src/components/MyCallout.astro`). The CMS updates both the live site and the editor preview (via §10; on edge, after the component is in the deployed build).
* **Roadmap (WordPress/Drupal Conversion):** future CLI tools compile WordPress `theme.json` / Gutenberg patterns or Drupal modules into a Saytu Theme Manifest.

## 9. Authoring, Drafts & Concurrency

Non-technical users must never face Git merge conflicts. Saytu uses **DB-backed drafts + pessimistic locking**.

* **Drafts live in the database** (debounced autosave to SQLite/D1). Git only sees committed, published content.
* **Pessimistic locking (V1, no CRDT):** `locked_by` + `locked_at`; a second editor sees read-only "Currently being edited by …". No Yjs/CRDT co-editing in V1.
* **Lock refresh = autosave (no separate heartbeat):** each autosave bumps `locked_at`; freshness is checked **lazily, only on contention** — avoids burning edge request quotas.
* **Lock lifecycle:** ~5–10 min TTL; after which another editor may take over (prompt); admins can **force-unlock**.
* **Publish:** explicit action compiles draft → Markdoc → Git commit (subject to §2 base-SHA check).

## 10. Editor Preview & Mixed-Framework Rendering

* **Server round-trip via Astro:** the preview API posts the AST to a renderer using Astro's container/render API (`Astro.render()`) → HTML string → editor iframe. The component registry in `saytu.config.ts` is **framework-agnostic** (path to file); the renderer handles `.astro` and framework components uniformly.
* **Edge boundary:** Astro SSR runs on Workers, so **previewing already-built components works everywhere, including edge.** workerd **cannot** compile a *brand-new* `.astro` at runtime — so **component authoring with hot preview is a local/Bun activity**, while **content editing with preview of the deployed component set** works in all topologies.
* **Debounce** preview renders.

## 11. Media: Library & Optimization

To keep Git lean, large binaries never live in Git.

* **Storage (`StoragePort`):** **S3-compatible first** (`@saytu/storage-s3`, AWS SDK v3 → B2/R2/AWS/MinIO) and **local** (`@saytu/storage-local` → `/public/uploads/drafts`). Upload pipeline: Tiptap drop → Storage Adapter → on edge a **pre-signed POST policy** (size cap via `content-length-range`, e.g. 5 MB) → browser uploads direct → CDN link embedded in the AST → on publish, draft assets sync to the provider before the Git commit.
* **Media library (V1, free):** asset browser, reuse, **alt-text** (a11y/SEO), search/folders.
* **Image optimization (`ImagePort`):**
  * **Build-time default (all topologies / SSG):** Astro `<Image/>` + **sharp** → responsive `srcset`/AVIF/WebP. Free, covers every SSG case.
  * **Runtime (SSR), pluggable adapter:** **edge** → Cloudflare Images / **Bunny Optimizer** / Cloudinary; **VPS/self-hosted** → **Truss** (Rust binary sidecar with signed transform URLs) — OSS, no SaaS dependency.

## 12. Search

* **Public SSG site → Pagefind.** Rust/WASM static index built **in the deploy pipeline** over generated HTML, shipped as static files, queried client-side. Fits the Zero-JS ethos.
* **Public SSR site + all admin search → SQLite/D1 FTS5.** In SSR the public site already reads the derived index per request, so search is an **FTS5 virtual table** over it — live, no lag. The admin always has the index, so admin search is FTS5 in every topology.

## 13. Forms & Comments

**Architectural line: UGC (form submissions, comments) lives in the DB, never Git.**

* **Forms — built into core (not SaaS).** A form is a config-defined **block with a Zod schema**: POST → Hono `/api/forms/:id` → validated → stored via `DataPort` → optional `EmailPort` notify. Spam via **Cloudflare Turnstile**. Optional **webhook adapter** to forward externally (opt-in). Visual **form builder** is Pro; V1 ships native form *handling*.
* **Submission storage (per topology):** **D1** in Cloudflare/edge (the Pages Function writes the row), **SQLite** on VPS/local. In **SSG mode** "static" means page *rendering* only — the form POSTs to a live endpoint (Pages Function on edge / always-on Hono on VPS / local Hono in T1). Forms degrade gracefully as native HTML POST (no client JS); `fetch` optional for inline UX.
* **Canonical DB-only data + backup:** submissions exist *only* in the DB (the one exception to "DB is disposable"). **DR:** D1 **Time Travel** (free, ~30-day PITR) — necessary but not sufficient (whole-DB, destructive, stays in Cloudflare). **Ownership backup:** a scheduled **Cron Trigger** exports submissions to the **R2/S3 bucket** (NDJSON/CSV) + an admin **"Export submissions"** action. Same treatment for **users** and (later) comments.
* **Comments — deferred (post-V1):** native DB-stored + moderated (plugin/Pro), or **Giscus** embed. Never in Git.

## 14. Email & Notifications

`EmailPort` adapter — **optional but expected**. Used for form notifications, user invites, password resets, deploy/moderation notices.

* **VPS / local → SMTP** (nodemailer / Bun SMTP).
* **Edge → HTTP email API** (workerd has no raw SMTP sockets) → **Resend / Postmark / SES**. *(Cloudflare's free MailChannels Workers route ended in 2024 — don't design around it.)*
* Transactional templates in core; transport is the adapter.

## 15. The Three Deployment Topologies

### Topology 1: Local-to-Web (Tunnel Paradigm)
* **Target:** solo devs, agile agencies; zero CMS hosting cost.
* **Runs:** **Bun** locally. **Git is local — no remote required.** Publish = local commit → local Astro build → serve locally → **Cloudflare Tunnel**. Pushing + deploying to Pages is an optional toggle (§16). Tunneling the live site ties uptime to the machine (fine for personal/dev, not client prod).
* **Adapters:** `db-sqlite`, `storage-local`, `auth-*` (Better Auth). Docker **deferred to the T3 milestone**.

### Topology 2: Pure Edge (Zero-Infra Paradigm)
* **Target:** serverless-first, sites under ~500 pages (the limit is tied to edge reindex cost — building the D1 index by reading all content via the GitHub API is bounded by API rate limits; mitigated by incremental webhook reindex + durable index + Git Trees API).
* **Runs:** Admin SPA on **Cloudflare Pages**; API via **Hono**; Git via `GitPort` (GitHub API).
* **Adapters:** `db-d1`, `storage-s3` (R2/B2), `auth-cloudflare-access` (+ Better Auth optional), runtime `ImagePort` (CF Images/Bunny).

### Topology 3: VPS Hub (Enterprise Paradigm)
* **Target:** large teams; 24/7 uptime, concurrent locking, zero edge-compute for authoring.
* **Runs:** persistent **Docker** container on a Linux VPS.
* **Adapters:** `db-sqlite`, `storage-s3` (AWS S3 / MinIO), `auth-*` (Better Auth), `ImagePort` = Truss.

## 16. Content Delivery & Caching (Configurable)

Delivery is a developer choice; publish and deploy are **decoupled and role-gated**.

* **Publish states:** **Draft** (DB) → **Staged** (committed to Git; not yet live) → **Deployed** (live).
* **Publisher-gated deploy hook:** auto-build-on-push is **disabled**; only a **Publisher** firing the explicit deploy hook rebuilds/promotes the site. Enforces editorial control and removes the build-spam / Denial-of-Wallet vector.
* **SSG via CI/CD (default, smaller sites):** the hook regenerates the static site (rate-limited backstop).
* **SSR read-at-request (large/dynamic):** Astro SSR reads the derived index, fronted by **Cloudflare edge caching** + **purge-on-publish**. Each page emits a **`Cache-Tag`** header of its content IDs; publishing purges those tags (all-plan feature since April 2025). **Long/indefinite Edge TTL is configurable** — a mostly-static SSR site caches ~forever and relies on purge-on-publish.
* **Local-only vs remote-publish** is a configurable toggle (T1 stays fully local, or pushes + deploys to Pages).
* **Failure handling — non-destructive + retryable** (the draft is always safe in the DB):
  * **Commit fails** (API down, token expired) → "Publish failed → Retry" (idempotent, backoff on edge).
  * **Base-SHA conflict** → the §2 reload flow, ideally with a diff.
  * **Deploy-hook fails** → surface **deploy status** (pending/building/failed/live) + logs + re-trigger.
  * A unified publish/deploy **status surface** in the admin; Sentry-compatible error logging for self-hosters.

## 17. Identity, Authentication & Authorization

**Authentication is pluggable; authorization always lives in the app.**

* **Auth engine — Better Auth, behind `AuthPort`.** Runs on Bun and workerd; Drizzle/Kysely adapters target **SQLite and D1** (auth tables co-locate with index/drafts/locks). Provides email/password + GitHub/Google OAuth + sessions + `admin`/`organization` roles plugins, so Saytu never hand-rolls security-critical code. *(Spike: validate the D1 adapter — Hono examples used Postgres/Neon.)*
* **Cloudflare Access** = a separate edge adapter (external IdP gate). Hono middleware **must verify the signed Access JWT** against Cloudflare's keys — never trust the header blindly.
* **App code depends only on `AuthPort`** (`→ { email, role }`).
* **Authorization:** roles live in the DB in every install. Baseline: **Admin, Publisher, Editor, Viewer**. **No solo/team special-casing** — solo is one row. Path-scoped permissions are later/Pro.
* **Passwords** stored only as salted one-way hashes (Better Auth). Self-hosting trust model: whoever controls the server controls the data — inherent and accepted.

## 18. Security & DoW (Denial of Wallet) Defenses

* **Auth-gated uploads:** `POST /api/upload/sign` requires a valid session/JWT (else `401`); signed POST policy enforces max file size at the provider.
* **Build-cost protection:** deploys gated behind the Publisher hook (§16), never auto-triggered by push; rate-limited backstop.
* **Clean-URL convention + cache key:** path-based clean URLs (§4), so query strings carry nothing meaningful; Cloudflare **Cache Key excludes query strings by default**, neutralizing cache-busting botnets without stripping. Devs needing query-dependent rendering opt specific params back in.
* **Custom HTML/JS embeds are admin/developer-role only** — never the general Editor role (stored-XSS / exfiltration vector). Pages using custom JS forgo a strict CSP (a known, scoped tradeoff). For the common case (analytics), prefer a first-class **admin-only "analytics snippet" setting** over per-page script tags.
* **Spam:** Cloudflare **Turnstile** on public form submissions.
* **Admin Auth:** all `/admin` + `/api` routes protected by Hono middleware validating sessions / JWTs / Access tokens (signature-verified).

## 19. Licensing

* **Core + adapters → AGPL-3.0.** Chosen because Saytu's users are self-hosters (AGPL is invisible to them — it only triggers if you offer *modified Saytu itself* as a network service), it blocks cloud-cloning of the engine, and enterprise-legal friction converts into commercial-license revenue rather than lost users.
* **CLA required** from every contributor, in place **before the first non-author contribution** (public or private; private collaborators need an IP-assignment clause). The CLA is the linchpin — it enables both the commercial dual-license **and** the option to relicense later (e.g. AGPL → Apache, the easy direction since loosening only needs copyright control).
* **Commercial dual-license** sold to those who can't accept AGPL (enterprise bans) — friction → revenue.
* **Pro plugins → proprietary/commercial EULA.** Closed, paid. As sole copyright holder (via CLA), Saytu can license its own Pro plugins proprietarily even atop AGPL core.

## 20. Open-Core / Monetization Boundary

Core is 100% open-source; the model is **open-core framed as a "convenience fee"** — syntax and data stay open (anyone may hand-author or build custom); what's paid is the saved time of pre-built tooling and the runtime. **The capability is always free; the no-code/visual/automated convenience around it is Pro.**

### 20.1 Feature Tiers

| Area | Free (OSS, AGPL) | Pro (paid add-on) | Managed Cloud (SaaS) |
|---|---|---|---|
| **Editing** | Visual editing of static/component content; `markdocPassthrough` preservation of advanced syntax (edit in raw/code mode) | Visual builders for **dynamic Markdoc** (conditional / variable / loop UI) + the SSR runtime that resolves them | — |
| **Content model** | `post` + `page` collections; **custom types/fields as code** in `saytu.config.ts` | **Visual content-type & field builder** (no-code) | — |
| **URLs** | Permalink UI for default types; **automatic 301s** on slug/permalink change | Permalink GUI for **custom** types; **redirect manager** UI (manual/bulk/import) | — |
| **SEO** | Meta title/description, canonical, OG/Twitter image, `sitemap.xml`, `robots.txt`, hreflang | **SEO plugin:** JSON-LD structured data, scoring/readability, social-card customization, bulk meta, internal-link suggestions | — |
| **i18n** | Structural: locale dimension, locale routing, hreflang, translatable admin UI | **Translation-management workspace** (linking, stale-detection, side-by-side, fallback) | — |
| **Media** | Library (browse/reuse/alt-text); build-time image optimization (sharp); runtime `ImagePort` adapters | *(advanced DAM — later)* | — |
| **Forms** | Native form handling (block + Zod + Turnstile + webhook) | **Visual form builder** | — |
| **Search** | Pagefind (SSG) + FTS5 (SSR/admin) | — | — |
| **Workflow** | Draft → Staged → Deployed; Publisher-gated deploy | **Editorial review/approval**, **scheduled publishing**, **version-history UI**, **shareable draft preview links** | — |
| **Collaboration** | Pessimistic locking | **Real-time collaboration** (CRDT) | — |
| **Roles** | Admin / Publisher / Editor / Viewer | **Path-scoped roles + audit log**, **enterprise SSO** | — |
| **Deployment** | All three topologies; SSG + SSR; Git-backed ownership | — | Optional managed hosting |
| **Multi-site** | One repo = one site | — | **Multi-site marketing-overview aggregator** federating N installs |
| **Migration** | WordPress **WXR** + Markdown importers | — | Full page-builder-fidelity migration **service** |

### 20.2 Enforcement

The Pro gate lives in **proprietary cloud/license components, never in OSS code** (see §19). As sole copyright holder via the CLA, Saytu can ship proprietary Pro plugins atop the AGPL core.

## 21. Roadmap (post-V1)

* **V1 includes:** core engine + all three topologies; content model (post/page + code-defined custom types); permalinks + auto-redirects; SEO basics; structural i18n + admin-UI localization; media library + image optimization; search; forms; email; Better Auth; **content import (WordPress WXR + Markdown/frontmatter importers — best-effort block mapping, unknowns preserved/flagged)**; **`create-saytu` scaffolding CLI** (+ `saytu init` for existing projects).
* **Pro / later:** everything in §20 Pro; multi-site SaaS aggregator; WordPress/Drupal theme-conversion CLI; comments (native or Giscus); personalization / A-B testing; additional `GitPort` (GitLab/Gitea), `ImagePort`, `EmailPort` adapters; Docker image (ships with the T3 milestone).

## 22. Tech Stack (2026 Standards)

* **Framework:** **Astro 6.4+** (forward-compatible with Astro 7 alpha / Vite 8).
* **Backend API:** **Hono** (Astro 6.3+ advanced routing).
* **Runtime:** **Bun** (local/VPS) + **workerd/Miniflare** (edge, via `platformProxy`).
* **Editor:** **Tiptap (ProseMirror)**.
* **Content Syntax:** **Stripe Markdoc** (`*.mdoc`).
* **Database / ORM:** **SQLite** (`bun:sqlite`) or **Cloudflare D1**; **Drizzle + Drizzle Kit** migrations; **FTS5** search.
* **Auth:** **Better Auth** (behind `AuthPort`) + **Cloudflare Access** adapter.
* **Search:** **Pagefind** (SSG) + **FTS5** (SSR/admin).
* **Images:** **sharp** (build-time) + `ImagePort` runtime adapters (Cloudflare Images / Bunny / Cloudinary / **Truss**).
* **Spam / Email:** **Cloudflare Turnstile**; **EmailPort** (SMTP / Resend / Postmark / SES).
* **Validation:** **Zod** across all API boundaries.
* **License:** **AGPL-3.0** (core) + CLA + commercial dual-license; proprietary Pro.

## 23. Monorepo Directory Structure (pnpm workspaces)

```text
saytu/
├── apps/
│   ├── saytu-admin/         # React SPA for the CMS interface (Tiptap)
│   ├── demo-site/           # Astro 6.4 template showcasing the live frontend
│   └── server-vps/          # Bun/Node wrapper for Dockerized Topology 3 (later)
│
├── packages/
│   ├── core/                # config parser, content model, Tiptap↔Markdoc AST, drafts/locks,
│   │                        # publish pipeline, permalinks/redirects, Git bridge, re-index, forms
│   ├── db-sqlite/           # Adapter: Local SQLite (index + drafts + locks + users + FTS5)
│   ├── db-d1/               # Adapter: Cloudflare D1
│   ├── storage-local/       # Adapter: Local File System
│   ├── storage-s3/          # Adapter: S3-Compatible (B2, R2, AWS, MinIO)
│   ├── image/               # ImagePort + sharp (build) / CF Images / Bunny / Cloudinary / Truss
│   ├── auth/                # AuthPort + Better Auth wiring
│   ├── auth-cloudflare-access/ # Adapter: Cloudflare Access (edge)
│   ├── git/                 # GitPort + GitHub adapter (edge commit/read)
│   ├── email/               # EmailPort + SMTP / Resend / Postmark / SES adapters
│   ├── search/              # Pagefind pipeline integration + FTS5 helpers
│   ├── create-saytu/        # Scaffolding CLI (bun create saytu) + `saytu init`
│   └── astro-integration/   # @saytu/astro - injects /admin routes, Hono APIs, preview render
│
├── package.json
├── pnpm-workspace.yaml
└── turbo.json               # Caching for fast monorepo builds
```

## 24. Admin UX & Design

* **Aesthetic — Notion-inspired:** minimal, content-first, modern; with **WordPress-familiar information architecture** so refugees feel instantly at home. Bar: Notion/Linear polish + WP familiarity.
* **The admin is a rich React SPA.** "Zero-JS by default" governs the *output site*, not the admin — the admin can be as rich as it needs to be.
* **Stack:** **React + Tailwind + shadcn/ui (Radix primitives)** — fast to build, accessibility-first, fully ownable (no proprietary UI dependency; fits the OSS ethos).
* **Information architecture (left sidebar):** Dashboard (recent edits, who's-editing/locks, deploy status) · Content (Posts / Pages / custom collections) · Media · Forms (submission inboxes + export) · Site (preview link, deploy controls, deploy history) · Settings (permalinks · SEO defaults · locales/i18n · users & roles · auth · integrations: email/image/storage · analytics snippet).
* **The Editor (the heart):** Tiptap canvas with a **slash menu** driven by `saytu.config.ts`; drag handles for blocks; a **right context panel** that swaps between page metadata (title, slug, status, author, date, locale, taxonomy, custom fields, SEO) and the selected block's props; a persistent **Draft → Staged → Deployed** state pill; an **autosave indicator**; **lock/presence** ("Sarah is editing"); a **locale switcher**; and a **Preview toggle** that flips to (or splits with) the server-rendered iframe (§10).
* **`markdocPassthrough`** renders advanced/Pro Markdoc as labeled, read-only chips inline.
* **Content list view:** fast, filterable table (title · status · author · locale · updated) with FTS5 search, bulk actions, and per-row lock indicators.
* **Pro features are visible but gated** — shown with a subtle "Pro" chip + upsell, never hidden (discovery drives conversion).
* **Mode-aware:** deploy controls and a few settings adapt to topology; the core UX is identical everywhere.

## 25. Accessibility

Two distinct surfaces, very different in difficulty:

* **(a) Admin / editor — target WCAG 2.1 AA (ongoing investment).** The **chrome** (menus, dialogs, popovers, the slash menu) gets accessibility largely for free from **Radix/shadcn** (correct ARIA, focus management, keyboard nav). The **editing canvas** is the hard part: Tiptap/ProseMirror's core `contenteditable` is keyboard- and screen-reader-accessible for basic text, but custom work is required — the **slash menu** needs the ARIA combobox/listbox pattern, **node views** must be built accessible, every block needs an accessible name, and **drag-and-drop reordering must have a keyboard alternative** (move up/down via command). Honest caveat: Notion-style block editors are among the hardest things to make fully accessible — AA is achievable with deliberate effort, not for free.
* **(b) Output site — enforced and first-class (the easier, differentiating win).** Semantic HTML components, **enforced alt-text** (via the media library), heading-structure validation, and **a11y linting in the build pipeline**. "Accessible output by default" overlaps with the SEO pillar and is far more tractable than perfect editor a11y — make it a marketed feature.

---

## 🤖 Instructions for the AI Developer (System Prompt Context)

1. **Architecture First:** Never couple DB, file system, images, auth, email, or Git host to Astro. Route through the Ports in `packages/core`. Default storage to AWS SDK v3 `@aws-sdk/client-s3`.
2. **Git is canonical for published content; the DB is a derived index + drafts + locks + users + UGC.** UGC (form submissions, comments) lives in the DB, never Git. Migrate canonical tables (Drizzle); rebuild derived tables from Git.
3. **Content vs. Code separation:** marketers edit `*.mdoc` + metadata via admin (DB drafts → publish → Git); developers edit components/config/themes in Git. Keep disjoint.
4. **Content model:** typed collections (`post`, `page` default; custom types as code in `saytu.config.ts`, GUI builder is Pro). Entry identity `(collection, locale, slug)`. Locale is a first-class dimension; site is not (one repo = one site).
5. **URLs/SEO:** per-collection permalink patterns; **auto-generate 301s on slug/permalink change**; ship sitemap.xml, robots.txt, per-entry meta + hreflang free. Advanced SEO is a Pro plugin.
6. **Drafts & locking:** DB-backed drafts, pessimistic locking, lock refresh via autosave (no heartbeat), lazy contention check, TTL + take-over + admin force-unlock; verify base Git SHA on Publish.
7. **Never drop content:** the `markdocPassthrough` node preserves/re-serializes unsupported Markdoc verbatim.
8. **Preview:** framework-agnostic Astro render/container API for `.astro` + framework components; edge can't compile new components (hot authoring is local/Bun).
9. **Media/images:** media library with alt-text; `ImagePort` = sharp at build (default) + runtime adapters (CF Images/Bunny/Cloudinary/Truss) for SSR.
10. **Delivery:** decouple Publish (→ Staged) from Deploy (Publisher-gated hook → Deployed); disable auto-build-on-push; SSG-via-CI and SSR with `Cache-Tag` + purge-on-publish + configurable long TTL; failures are non-destructive + retryable with a status surface.
11. **Auth:** Better Auth behind `AuthPort` (SQLite/D1; validate D1 in the spike); Cloudflare Access as a separate adapter with verified JWTs; roles enforced in handlers; always a users table.
12. **Search/Forms/Email:** Pagefind (SSG) + FTS5 (SSR/admin); native forms (block + Zod → Hono → DataPort + Turnstile + optional EmailPort); EmailPort over SMTP or Resend/Postmark/SES.
13. **Security:** auth-gate upload sign; pre-signed POST + size caps; clean URLs with query strings excluded from cache key; **custom HTML/JS embeds admin-only**; verify all admin/API tokens.
14. **i18n:** structural (locale dimension, locale routing, hreflang, translatable admin UI) is V1/free; the translation-management workspace is Pro.
15. **License:** core is AGPL-3.0; keep all code under CLA so dual-licensing and future relicensing stay possible; Pro plugins are proprietary.
16. **Astro 6.4 & Local Dev:** Astro 6.3+ Cloudflare helpers for env/D1 bindings; first-class Hono for `/api/*`; `platformProxy: { enabled: true }`; secrets in `.dev.vars`.
17. **Admin UX:** Notion-inspired, React + Tailwind + shadcn/ui; rich SPA (Zero-JS is for output only); slash-menu from config; Pro features visible-but-gated.
18. **Accessibility:** Admin targets WCAG 2.1 AA (lean on Radix for chrome; build the slash menu as an ARIA combobox; give drag-reorder a keyboard alternative). Enforce accessible *output*: semantic HTML, required alt-text, heading-structure + a11y linting in the build.
19. **Strict Typing:** Zod across all API boundaries.
