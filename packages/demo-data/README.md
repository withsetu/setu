# @setu/demo-data

Content packs and the seed engine for Setu's dev-mode demo-data add-on (epic
[#509](https://github.com/withsetu/setu/issues/509); increments
[#511](https://github.com/withsetu/setu/issues/511) — packs — and
[#512](https://github.com/withsetu/setu/issues/512) — the engine).

**Node-only by design.** This is dev tooling: it reads/writes the filesystem,
shells out to `tar`, and does bulk work no edge topology should ever run. Nothing
edge-reachable may import it — it stays outside `packages/core/tsconfig.edge.json`
and outside any production bundle. The dev-only Demo Data panel (#513) is its
next consumer.

## What a content pack is

A pack turns an **open, licensing-verified dataset** into a normalized stream of
post-shaped seed material. The contract lives in [`src/contract.ts`](src/contract.ts):

- `ContentPack` — `meta` (id, name, source citation URL, license summary) +
  `load(options)` → `PackDataset`.
- `PackDataset` — `posts: AsyncIterable<PackPost>` + `stats()`. **Streaming, not
  an array**: the AIC dump alone is 134k records / ~1 GB of JSON on disk, so a
  pack must be consumable one post at a time without materializing the dataset.
  `stats()` reports `scanned` / `loaded` / `skipped`-by-reason counters (bad
  records are skipped and counted, never a crash).
- `PackPost` — id, title, markdown `body` (real source fields only), `excerpt`,
  ISO `date`, `sourceAttribution`, `terms` grouped by taxonomy
  (`{ categories, tags }`), optional `image`.
- `PackImageRef` — image `license` + `urlForWidth(width)` so the engine can pick
  a big/medium/small width mix by construction, plus intrinsic `maxWidth`/
  `maxHeight` when the source publishes them. Packs never download image bytes;
  that is the #512 engine's job.

Every pack must pass the exported **contract test suite** (the same ports pattern
as `@setu/storage-testing`): import `runContentPackContract` from
`@setu/demo-data/contract-suite` and run it over local fixtures. The suite checks
meta completeness, post normalization (non-empty title/body/excerpt, valid ISO
date, terms arrays), image-URL sanity across several widths, stats consistency,
determinism, and `limit` handling. It lives on a subpath so runtime consumers of
packs never pull vitest into their module graph.

## Licensing rules (non-negotiable)

- Every pack **states its license** in `meta.license` and documents per-field
  exceptions here.
- The repo **ships no third-party content**: packs fetch at seed time; the
  committed test fixtures are synthetic records authored for this repo (see
  [`test/fixtures/README.md`](test/fixtures/README.md)).
- No NC-licensed or copyrighted material may ship in or be fetched by default
  (epic #509 rejected OMDb for exactly this).
- Keyless sources only; a bring-your-own-key pack, if ever added, reads env only.

## The AIC pack (Art Institute of Chicago)

All source facts verified 2026-07-16 against the linked pages:

- **Data dumps** (preferred for bulk per AIC's own docs — "You want to scrape a
  large result set (>10,000 records)"):
  [github.com/art-institute-of-chicago/api-data](https://github.com/art-institute-of-chicago/api-data),
  full tarball `https://artic-api-data.s3.amazonaws.com/artic-api-data.tar.bz2`
  (measured 119,891,546 bytes compressed; ~2.5 GB extracted, of which
  `json/artworks/` is 134,078 bare per-artwork records / ~1 GB). Refreshed
  monthly. `getting-started/allArtworks.jsonl` carries only 5 key fields and is
  NOT usable as pack input.
- **Licensing** (API `info.license_text`, quoted): "The `description` field in
  this response is licensed under a Creative Commons Attribution 4.0 Generic
  License (CC-By) … All other data in this response is licensed under a Creative
  Commons Zero (CC0) 1.0 designation and the Terms and Conditions of artic.edu."
  Post bodies therefore end with a source link plus "Description © Art Institute
  of Chicago, licensed under CC BY 4.0".
- **Public-domain filter**: only records with `is_public_domain === true` (and a
  usable `image_id`, description, title, and date) become posts; everything else
  is skipped and counted (`invalid` / `notPublicDomain` / `noImage` / `noText` /
  `noDate`).
- **IIIF sizing** ([api.artic.edu/docs](https://api.artic.edu/docs/)):
  `https://www.artic.edu/iiif/2/{image_id}/full/{width},/0/default.jpg`; AIC
  recommends width 843 as the most cache-friendly, and arbitrary widths are
  valid — which is exactly what `PackImageRef.urlForWidth` exposes.
- **Rate limits**: "Anonymous users are throttled to 60 requests per minute" —
  the bounded API sampler paces itself well inside that; bulk seeding always
  uses the dump.

Input for `createAicPack({ source })` is either the extracted dump's
`json/artworks/` directory (numeric-id order, one JSON file per record, each read
size-capped) or a `.jsonl` file (one bare record per line — the shape
`fetchAicSample` writes). Both are streamed.

### Fetching

`fetchAicDump(destDir)` downloads the tarball through core's SSRF-hardened
`safeFetch` seam (https-only, redirect-capped, size-capped, time-capped, DNS
answers range-checked via a Node resolver — the `apps/api/src/sitehealth.ts`
pattern). `safeFetch` buffers responses by design; ~115 MiB in memory is an
accepted trade for a dev-only CLI versus hand-rolling a bespoke streaming fetch
outside the hardened seam. Extraction shells out to the **system `tar`**
(bsdtar/GNU tar both read `.tar.bz2`): Node has no built-in bzip2 decompressor
and a decompression dependency for dev tooling fails the supply-chain check.
Only the artworks subtree is extracted. No API keys anywhere.

### CLI

```sh
pnpm --filter @setu/demo-data aic fetch  [destDir]           # full dump download + extract + stats
pnpm --filter @setu/demo-data aic sample [destFile] [count]  # bounded slice via the public API
pnpm --filter @setu/demo-data aic stats  <source> [limit]    # pack stats over a dump dir or .jsonl
```

Defaults write under `.demo-data/` (gitignored). `fetch` reuses an existing
non-empty tarball in the destination instead of re-downloading (the dump
refreshes monthly — delete the tarball to force a fresh copy).

## The seed engine (#512)

`seedDemoData(options)` fills a **dev content sandbox** (never canonical
`content/`) from a pack: demo users per role, posts committed straight to Git,
categories registered, featured images downloaded and ingested. `removeSeeded()`
is the inverse — the "remove generated only" primitive #513's reset levels
consume. Both live in `src/engine/`.

How it writes, and why:

- **Users** — better-auth's own `internalAdapter` over the sandbox's
  `.setu/submissions.db` (the exact seam `e2e/lib/seed-users.ts` and the api's
  admin-invite use). Deterministic identities (`demo-<role>-<n>@demo.setu.test`),
  generated passwords surfaced ONCE in the summary/CLI output and never logged
  by the engine.
- **Posts** — chunked `git.commitFiles` (~200 files per atomic commit),
  committed **as the owning demo user's git identity**; ownership is a weighted
  round-robin across all four roles (authors most, admins least). Frontmatter:
  `cid` / `title` / `date` / `published: false` for a configurable draft
  fraction (the repo's only draft signal) / `categories` + `tags` slugs /
  `featuredImage` / `author` (forward-compatible with #142 — nothing reads it
  yet; commit authorship carries attribution today).
- **Categories** — pack terms merged into `taxonomy/categories.yaml` via the
  core taxonomy ops in ONE batch commit (the per-mutation TaxonomyService is
  wrong for bulk).
- **Images** — a resumable bounded-concurrency batch (default 4): core
  `safeFetch` (15 MiB/60 s caps, descriptive User-Agent — AIC 403s anonymous
  UAs), width mix per post clamped to the source's intrinsic width (AIC 403s
  over-width IIIF requests), core `ingestImage` (upload-route width ladder) plus
  the `.media.json` record so the media library lists seeded items. Failures are
  counted, never fatal; a re-run retries them.
- **Resume & removal state** under `<sandbox>/.setu/`:
  `demo-seed-checkpoint.json` (per-run; completed images/chunks are skipped on
  re-run) and `demo-seed-manifest.json` (append-safe across runs; records every
  generated slug/media key/user/category — what `removeSeeded` consumes).
  Re-running the same seed is idempotent; a larger re-seed reuses existing
  slugs/cids.
- **Single-writer warning** — git-local serializes commits in-process only, so
  the engine probes the dev api port and warns; stop `pnpm dev` (or use a
  separate sandbox) during large seeds. And per card #7: seeding **commits**
  content — a static site build still needs its own rebuild (saved ≠ live).

```sh
pnpm --filter @setu/demo-data seed -- --posts 1000            # defaults: 1 admin, 1 maintainer, 2 editors, 5 authors
pnpm --filter @setu/demo-data seed -- --posts 50 --relax-text --limit-images 20 \
  --sandbox .content-sandbox/demo --media .setu/demo-uploads
pnpm --filter @setu/demo-data unseed                          # remove ONLY what seeding generated
```

Sandbox/media default to the `pnpm dev` dirs (`$SETU_REPO_DIR` /
`$SETU_MEDIA_DIR` env override first). `--relax-text` uses the pack's relaxed
text tier (`createAicPack({ textTier: 'relaxed' })`): records with only a
`short_description` are admitted with an honestly-labeled template body, pushing
the AIC yield past the ~6.4k strict ceiling; attribution footers are kept.

## Tests

`pnpm --filter @setu/demo-data test` — fixture-only, no network, no sharp, no
sqlite in the seed lane (integration tests run against a real temp git repo with
injected fetch/ImagePort/UserStore fakes; the sqlite user store has its own
real-db test). One opt-in integration test hits the real AIC API and is excluded
by default; run it with:

```sh
DEMO_DATA_ONLINE=1 pnpm --filter @setu/demo-data test
```
