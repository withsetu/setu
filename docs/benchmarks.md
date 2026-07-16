# Benchmarks — 10,000-entry scale proof (#465)

Measured 2026-07-15 on the setup below. Numbers are from a real run of the commands in the
runbook, not estimates. Where a number is a median it says over how many runs; expensive
steps (the site build) are single runs.

## Setup and honest caveats

- **Hardware:** Apple M4 Max, 16 cores, 48 GB RAM, macOS 26.2, Node 22.18, local SSD.
  Expect meaningfully slower numbers on CI runners or small VPSes.
- **API mode:** `tsx src/server.ts` with `SETU_MODE=local` — the TypeScript sources run
  through tsx exactly like `pnpm dev` (minus the file watcher). No build/minify step, so
  per-request numbers carry tsx/dev overhead; treat them as upper bounds.
- **Machine was not idle:** other dev servers from concurrent worktree sessions were
  running (idle) during measurement. Query latencies were stable across 20 iterations, so
  contamination is small, but this is not a lab environment.
- **Timing method:** `performance.now()` / `Date.now()` around `fetch` calls from a Node
  script on the same host (loopback, no TLS). 20 sequential iterations per query endpoint,
  reporting p50/p95; cold-start numbers are 4 runs, incremental-reindex 3 runs.

## Corpus

Seeded by the runbook below (recipe seeder cycling the 684-meal TheMealDB cache):

| Property | Value |
|---|---|
| Post entries (`content/post/en/*.mdoc`) | 10,000 (10,003 after the incremental-reindex probes) |
| Page entries (canonical `content/page/` carried over) | 8 |
| Total content size on disk | 39 MiB |
| Distinct tags / categories | 1,036 / 14 |
| Media files | **0** — the seeder references external image URLs; no local media set was fabricated, so media-grid behavior at thousands of assets is **not covered** by this run |
| Sandbox git repo | 1 seed commit (+3 one-file commits from the incremental test) |

## Results

### Cold server reindex (boot warm-up)

Fresh `.setu/` (index + auth db deleted), api spawned, first authenticated
`GET /api/index/query?collection=post&limit=25` issued ~2 s after spawn — it latches onto
the in-flight boot build and resolves when the index is ready. 4 runs.

| Metric | Value |
|---|---|
| Process spawn → server listening | ~1.1 s |
| Process spawn → first successful query (index built) | **68.7 s median** (runs: 71.6 / 67.0 / 70.3 / 62.2) |
| The first query request itself (blocked on the boot build) | 60–69 s |
| Second (warm) query | 20 ms median (18–29) |
| sqlite db size after build (`.setu/submissions.db`) | 7.0 MB |
| API worker peak RSS during the cold build | 539 MB |
| API worker RSS, warm after build | ~186 MB |

Filed as #504 — the build is effectively O(N²) (see analysis).

### Query latencies, warm (20 iterations each, authenticated)

| Endpoint | p50 | p95 | Notes |
|---|---|---|---|
| Default listing `?collection=post&limit=25` | 15.4 ms | 25.3 ms | total=10,000 |
| Text search `?q=chicken` | 16.6 ms | 17.1 ms | 849 matches |
| Tag filter `?tag=chicken` | 15.3 ms | 16.1 ms | 295 matches |
| Facets `/api/index/facets` | 64.4 ms | 68.0 ms | 1,036 distinct tags aggregated |
| Deep page `?offset=9000&limit=25` | 16.3 ms | 17.5 ms | no offset penalty visible |
| Editor open `GET /git/file` (one 2 KB entry) | 7.7 ms | 8.9 ms | isomorphic-git blob read at HEAD |

### Incremental reindex (one new entry via `POST /git/commit-files`)

Median of 3 runs; polled `?q=<unique title>` every 25 ms after the commit response.

| Metric | Value |
|---|---|
| Commit round-trip | 104 ms |
| Commit response → entry visible in index | 161 ms |
| Commit POST begin → entry visible | 260 ms |

### Full site build (`astro build`, single run)

| Metric | Value |
|---|---|
| Wall time (prebuild codegen + astro build + integrations) | **32 m 19 s** (1,939 s; astro's own "32m 0s" excludes prebuild) |
| `gen-relations` prebuild (10,011 graph keys) | ~3 s |
| Pages built | 28,273 |
| `dist/` file count | **28,294** |
| `dist/` total size | 712 MB (largest files ≪ 25 MiB) |
| Peak astro RSS | 4.8 GB |

Phase decomposition (from the build log):

| Phase | Time | Per-unit |
|---|---|---|
| Taxonomy + archive pages (~18.3k pages) | ~25 s | 1–3 ms/page |
| 5 sitemap routes (post/page/category/tag/sitemap.xml) | ~13.2 min | **2.5–2.9 min each** |
| 10,003 post pages | ~14.9 min | ~89 ms/page |
| Per-page CSS purge integration | 3 m 19 s | 48.9 MB → 44.2 MB CSS inlined across 28,273 pages |

(`rss.xml` emitted empty in 2 ms — the feed defaults to disabled and the sandbox has no
`settings.json`, so feed cost at 10k was not exercised. A feed is capped at
`reading.feed.items` = 20 entries anyway, so it would not scale with N.)

**Cloudflare Pages deploy caps:** 28,294 files is **41% over the 20,000-file free-tier
cap** — a 10k-post site at this tag density does not deploy on the free tier today
(headroom on the 100k paid tier: ~3.5× this corpus). No file approaches the 25 MiB/file
cap. Filed as #507.

## Analysis — where the knees are

1. **Cold index build is O(N²) in entry count** (~69 s at 10k). `createIndexService.rebuild`
   reads every entry with `git-local`'s `readFileAtHead`, which calls isomorphic-git
   `readBlob` per file **without a shared `cache` object** — each read re-parses the commit
   and the `content/post/en` tree (10,000 entries) from scratch: 10k reads × O(N) tree parse
   ≈ 10⁸ entry decodes. Extrapolated to 50k entries: **~30 minutes of boot warm-up**, during
   which the first admin listing query hangs. Steady state is unaffected (warm queries stay
   fast; incremental commits take the diff path). Filed: **#504**.
2. **Per-entry `git log` subprocesses dominate the site build** (~28 of the 32 minutes).
   Posts without a frontmatter `date` fall back to `resolvePostDate` →
   `execFileSync('git', ['log','-1','--','<file>'])` — one serialized subprocess per entry.
   `loadSitemapEntries` is uncached, so **each of the 5 sitemap routes repeats the full
   10k-spawn sweep** (~2.5–2.9 min per sitemap), and every post page adds one more spawn
   (~89 ms/page). ≈60k `git` invocations per build; each one also walks history in a
   10k-file repo, so per-spawn cost grows with repo size too. Filed: **#506** (the >50k-URL
   sitemap *format* split is separately tracked in #322).
3. **Archive fan-out multiplies deploy file counts.** With the default `postsPerPage = 6`
   and recipe-style tagging (≈9 tags/post), 10k posts emit ≈15.0k tag-archive pages + 1.7k
   category pages + 1.7k main-archive pages on top of the 10k post pages → 28.3k files,
   over the CF free-tier cap. The knee at this tag density is ≈7k posts. Filed: **#507**.
4. **Steady-state reads are healthy at 10k.** Warm queries are 15–17 ms regardless of
   filter or offset depth (sqlite index port, SQL-native pagination), facets ~65 ms over
   1,036 tags, editor-open ~8 ms, incremental reindex ~¼ s commit-to-visible. None of
   these are near a knee; at 50k expect facets and `q=` scans to grow roughly linearly
   but stay well under a second.

**Does 10k hold up?** The admin steady state does — comfortably. What does not: the
one-time cold index build (~69 s of blocked first paint), the full site build (32 min),
and free-tier deployability (file count). At 50k the cold build (quadratic) and the
build's git spawns (superlinear) are the first hard failures; the query path is not.

## Runbook — reproduce it

From a repo checkout (`pnpm install` done). Everything below writes only to the gitignored
`.content-sandbox/`; canonical `content/` is never touched.

```bash
# 0. Paths
WT=$PWD                                  # repo root
BENCH=$WT/.content-sandbox/bench
PORT=4499

# 1. Seed 10,000 posts (cache-first; the first run fetches TheMealDB once, ~700 meals,
#    then cycles them; repeat slugs get numeric suffixes)
node scripts/seed-recipes.mjs --count=10000 bench

# 2. Make the sandbox a git repo (the api's git-local + the index walk HEAD)
cd $BENCH
git -c user.name=Bench -c user.email=bench@setu.local init -q
git -c user.name=Bench -c user.email=bench@setu.local add -A
git -c user.name=Bench -c user.email=bench@setu.local commit -q -m 'seed 10k bench posts'
cd $WT

# 3. Cold-start measurement: fresh .setu, spawn the api, time to first query
rm -rf $BENCH/.setu
SETU_MODE=local SETU_API_PORT=$PORT SETU_REPO_DIR=$BENCH \
  SETU_MEDIA_DIR=$BENCH/.setu/uploads SETU_AUTH_RATELIMIT_ENABLED=false \
  pnpm --filter @setu/api start &        # note the spawn timestamp

# 4. Seed an admin user the way e2e does (call e2e/lib/seed-users.ts `seedUsers` on
#    $BENCH/.setu/submissions.db — via jiti with the workspace TS aliases), then sign in
#    and keep the cookie:
#    POST :$PORT/api/auth/sign-in/email {email,password}  with Origin: http://localhost:5173
# 5. GET /api/index/query?collection=post&limit=25 with the session cookie. It blocks on
#    the in-flight boot build; response arrival = cold reindex done.
# 6. Latencies: repeat each endpoint in the results table 20x, record p50/p95.
# 7. Incremental: POST /git/commit-files
#      {changes:[{path:'content/post/en/probe.mdoc', content:'---\ntitle: Probe\n---\n\nx'}],
#       message:'probe', author:{name:'Bench',email:'bench@setu.local'}}
#    then poll ?q=Probe until total >= 1.

# 8. Site build (expect ~30 min at 10k on fast hardware — see analysis #2)
SETU_CONTENT_DIR=$BENCH/content SETU_SITE_URL=https://example.com \
  pnpm --filter @setu/site build
find apps/site/dist -type f | wc -l
du -sh apps/site/dist

# 9. Cleanup
rm -rf $WT/.content-sandbox/bench apps/site/dist
```

Steps 3–7 were driven by throwaway Node scripts (spawn + poll + `fetch` timed with
`performance.now()`); any HTTP client reproducing the same requests gives comparable
numbers — the interesting quantities are all ≥ milliseconds.
