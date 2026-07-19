import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { bodyLimit } from 'hono/body-limit'
import {
  createAuthz,
  DEFAULT_ROLES,
  parseContentPath,
  parseMdoc,
  unicodeCaseFold
} from '@setu/core'
import type { Action, GitPort, CommitInput, CommitFilesInput } from '@setu/core'
import { authMiddleware } from './auth/middleware'
import { apiOnError } from './errors'
import type { ResolveActor, ResolvedActor } from './auth/resolve-actor'

export { createFormsApi } from './forms'

const authz = createAuthz(DEFAULT_ROLES)

/** Repo-root files that persist through this shared git primitive but demand a stronger write
 *  permission than ordinary content — there is NO dedicated settings/theme route, so the write gate
 *  must distinguish them BY PATH. Otherwise any `content.edit` holder (author/editor) could rewrite
 *  them, bypassing the action the admin UI gates them behind (failure mode #13):
 *    - `settings.json`      → `settings.manage` (admin only; UAT 2026-07-05)
 *    - `theme-options.json` → `theme.manage`    (maintainer+/admin; the Appearance screen's gate — #419)
 *  Keys MUST be lowercase AND ASCII — the lookup case-folds the path (see `foldRepoPath`) so
 *  `Settings.json` on a case-insensitive filesystem (macOS/Windows), which is the SAME inode,
 *  cannot slip the gate. `isCanonicalRepoPath` guarantees every repo-ROOT path reaching that
 *  lookup is ASCII, which is what makes the fold faithful (see #644 there). */
const PATH_WRITE_ACTION: Record<string, Action> = {
  'settings.json': 'settings.manage',
  'theme-options.json': 'theme.manage'
}

/** Case-fold a repo path for gate matching, so a case-only variant can't slip the classification
 *  on a case-insensitive filesystem (macOS/Windows), where it is the SAME inode. Used ONLY for
 *  matching — the actual write uses the caller's path, which `isCanonicalRepoPath` has already
 *  proven identical modulo case.
 *
 *  #654: this used to be a bare `p.toLowerCase()` — Unicode SIMPLE CASE MAPPING, strictly weaker
 *  than the filesystem's case FOLDING — and the gap was papered over by rejecting non-ASCII at
 *  the repo ROOT only (#644), because content slugs legitimately carry non-ASCII. That left the
 *  content half open, which #647 had to record as a KNOWN GAP: `content/blog/en/ſive.mdoc` is its
 *  own `toLowerCase` form, so it passed the canonical-path rule while still colliding on APFS.
 *
 *  It is now the SHARED fold from `@setu/core` (`unicodeCaseFold`, packages/core/src/rename/
 *  slug.ts) — NFC plus an upper/lower round-trip, which collapses `ſ`→`s`, `ﬁ`→`fi`, `ß`→`ss`,
 *  `ı`→`i` and the composed/decomposed split. The SAME function backs entry-slug minting and the
 *  rename service's `target-exists` guard, so the gate, the vocabulary and the mover cannot drift
 *  into disagreeing about what "the same file" means — which is precisely how #654 happened. */
const foldRepoPath = (p: string) => unicodeCaseFold(p)

/** True iff `p` is a CANONICAL repo-relative path: non-empty, relative, no `.`/`..` segments, no
 *  repeated slashes, no leading/trailing slash, no surrounding whitespace, no backslash or NUL,
 *  and — for the parts the gate classifies on — canonically cased.
 *
 *  #623: the gate used to *normalize* (`p.replace(/^\.?\/+/, '').trim()`), which stripped only ONE
 *  leading `./` or `/` and did no path normalization at all — while the git adapter's `safePath`
 *  (packages/git-local/src/adapter.ts) uses `path.resolve`, which normalizes fully. The two
 *  disagreed, and every disagreement was a gate bypass: `content/../settings.json` gated as
 *  `content.edit` while the adapter wrote `settings.json`; `content/blog/en/./post.mdoc` made
 *  `parseContentPath` fail, skipping BOTH the publish check and the committed-state upgrade while
 *  the adapter wrote the real post.
 *
 *  The fix REJECTS non-canonical paths instead of normalizing them. Normalizing only ever closes
 *  the spellings we thought of; rejecting closes the class. The admin client (and every legitimate
 *  caller) always sends canonical paths — they come from the content index and the editor — so
 *  nothing legitimate is lost, and with the path guaranteed canonical the gate's view and the
 *  adapter's write are the same path by construction. */
export function isCanonicalRepoPath(p: unknown): p is string {
  if (typeof p !== 'string' || p === '') return false
  if (p !== p.trim()) return false
  if (p.includes('\\') || p.includes('\0')) return false
  if (p.startsWith('/') || p.endsWith('/')) return false
  if (p.includes('//')) return false
  if (p.split('/').some((seg) => seg === '.' || seg === '..')) return false
  // #644: a repo-ROOT path must additionally be ASCII. `foldRepoPath` folds with
  // `String.prototype.toLowerCase()` — Unicode SIMPLE CASE MAPPING — while a case-insensitive
  // filesystem (APFS/NTFS) resolves names by Unicode CASE FOLDING, a strictly LARGER relation.
  // Characters in the gap fold into ASCII without `toLowerCase` touching them, and each one is a
  // `PATH_WRITE_ACTION` bypass. Confirmed on macOS/APFS: `'ſ'.toLowerCase() !== 's'` (U+017F), yet
  // writing `ſettings.json` and reading `settings.json` hits ONE file — the same inode. So an
  // author (content.edit, NOT settings.manage) could send `ſettings.json`, miss the lookup, be
  // gated as ordinary content, and drive the adapter into the real settings file.
  //
  // REJECT THE CLASS, DON'T ENUMERATE THE SPELLINGS (the #623 lesson): U+017F is one of an
  // open-ended set of non-ASCII characters that case-fold into ASCII, so folding "better" only
  // ever closes the ones we thought of. Restricted to ASCII inputs, Unicode case folding and
  // `toLowerCase` COINCIDE — so this rejection is what makes `foldRepoPath` a faithful fold and
  // gives the gate its property: no two distinct ACCEPTED root paths can resolve to the same file
  // without the gate classifying them identically.
  //
  // Scoped to the ROOT on purpose. Every `PATH_WRITE_ACTION` key is a root file, so this is
  // exactly enough to close that lookup — while content paths legitimately carry non-ASCII slugs
  // (`entrySlugify` keeps `\p{L}`, so "Café" yields `content/blog/en/café.mdoc`), and a repo-wide
  // ASCII rule would reject real posts. That narrowness is the reason the sibling case-variant
  // hole on the `content/` PREFIX is a separate issue, not a silent widening of this one.
  if (!p.includes('/') && !/^[\x20-\x7e]+$/.test(p)) return false
  // #647: the `content/` half of the same class #644 closed for the root. `parseContentPath` is
  // CASE-SENSITIVE (`/^content\/…\.mdoc$/`), and `writeActionForChanges` uses its match as the
  // trigger for BOTH the publish check and the #382 committed-state upgrade. On a case-folding
  // filesystem every spelling that parser misses is a live post an author can rewrite. Measured
  // against a seeded LIVE `content/blog/en/live.mdoc`, sending `published: false` content:
  //     content/blog/en/live.mdoc -> content.publish   (correct)
  //     Content/blog/en/live.mdoc -> content.edit      parser misses; no publish check at all
  //     content/blog/en/live.MDOC -> content.edit      parser misses on the extension
  //     content/blog/en/Live.mdoc -> content.edit      parser MATCHES, but `git.readFile` misses
  //                                                    (git's index is case-SENSITIVE), so the
  //                                                    committed-state upgrade never fires
  // Two different mechanisms, one boundary — fixing only the first would leave the second open.
  //
  // The rule: if the FOLDED path is a content path, the literal path must already BE its folded
  // form. Rejection, not fold-insensitive classification: making `parseContentPath` case-blind
  // would silently start accepting `CONTENT/…` in its OTHER callers (the content index at
  // packages/core/src/index-port/index-service.ts, demo planning, the admin editor), which is a
  // far larger blast radius than this gate. This keeps the change local and fail-closed.
  //
  // Deliberately narrow: it only fires when the folded form parses as content, so ordinary repo
  // files that legitimately carry uppercase (`README.md`, `docs/GUIDE.md`, `LICENSE`) are
  // untouched, and canonical non-ASCII slugs (`content/blog/en/café.mdoc`) fold to themselves and
  // pass.
  //
  // #654 CLOSES what this used to record as a KNOWN GAP (and with it #648's acceptance
  // criterion). With `foldRepoPath` upgraded to the real `unicodeCaseFold`, the SAME rule now
  // also rejects a slug carrying a character that case-FOLDS into ASCII (`ſive.mdoc`, `ﬁle.mdoc`)
  // or that is spelled decomposed (`cafe` + U+0301) — each of which is its own `toLowerCase` form
  // yet the same inode as a different published post on APFS. No new rule, no enumeration of
  // spellings: a stronger fold made the existing class-rejection reach the class it was aimed at.
  //
  // Fold-STABLE non-ASCII slugs are untouched — `content/blog/de/über-uns.mdoc` and
  // `content/blog/ja/日本語.mdoc` fold to themselves and still pass, which is the line between
  // rejecting the collision class and banning i18n.
  if (parseContentPath(foldRepoPath(p)) !== null && p !== foldRepoPath(p))
    return false
  return true
}

/** Max bytes for a git write body. Generous enough for a bulk commit-files (hundreds of small
 *  `.mdoc` files in one atomic commit) yet a hard DoS ceiling on unbounded `c.req.json()`. Media
 *  uploads are multipart and capped separately in media.ts (25 MiB/file). */
const GIT_WRITE_MAX_BYTES = 10 * 1024 * 1024

/** One change in a commit, as the gate sees it: a path plus (for writes) the content being written.
 *  `content` is undefined for a deletion. */
export interface WriteChange {
  path: string
  content?: string
}

/** True if committing `content` to a content post PUBLISHES it live. Setu's rule (publish-semantics):
 *  an entry is live when committed and NOT `published: false`. So a missing/true `published` = live
 *  (requires `content.publish`); `published: false` = a draft (only `content.edit`). Fail-closed:
 *  unparseable content we can't prove is a draft is treated as a publish (the stronger permission). */
function publishesLiveContent(content: string): boolean {
  try {
    return parseMdoc(content).frontmatter['published'] !== false
  } catch {
    return true
  }
}

/** Precedence of the write actions this gate derives, weakest → strongest. In the DEFAULT_ROLES
 *  ladder each higher action's holders are a subset of the lower's (content.edit ⊂ content.publish ⊂
 *  theme.manage ⊂ settings.manage), so requiring the single strongest action a commit needs correctly
 *  implies the others — no actor can hold the strongest without the rest. A mixed commit therefore
 *  can't smuggle a privileged change past a lower-privilege one.
 *
 *  #622: that subset property lives in ANOTHER package (`DEFAULT_ROLES`, packages/core/src/authz)
 *  and was asserted only in this prose. It is now pinned by a test next to the data —
 *  packages/core/test/authz/write-action-ladder.test.ts — so the edit that breaks the assumption
 *  fails in the package that made it, not silently here. */
const WRITE_ACTION_RANK: Record<string, number> = {
  'content.edit': 0,
  'content.publish': 1,
  'theme.manage': 2,
  'settings.manage': 3
}

/** Rank of a derived write action. #622: an action OFF the ladder ranks `Infinity` — the strongest
 *  possible — not 0. The old `?? 0` floored an unknown action at `content.edit`, the WEAKEST rung,
 *  so any future action that reached this gate without a rank entry would have been silently
 *  downgraded to the permission every staff role holds. Ranking it strongest instead makes the
 *  reduction in `writeActionForChanges` fail CLOSED: the unknown action becomes the required one,
 *  and `authz.can` denies it for every role (no role's permission set contains an action that is
 *  not on the matrix), so the request 403s rather than being admitted on `content.edit`.
 *
 *  Unreachable today: every action `actionForChange` can return is a `PATH_WRITE_ACTION` value or
 *  one of the two literals, and all four are in the table. This is a REGRESSION GUARD for the next
 *  entry added to `PATH_WRITE_ACTION` (or a new derived action) without a matching rank. */
export const writeActionRank = (a: Action): number =>
  WRITE_ACTION_RANK[a] ?? Infinity

/** The write permission a single change requires, from its path and (for writes) NEW content only.
 *  (The committed-state half of the rule lives in `writeActionForChanges`, which can read git.)
 *   - a `PATH_WRITE_ACTION` file (settings.json / theme-options.json) → its mapped action
 *   - a content post going live → `content.publish` (publishing is gated server-side, not just in
 *     the UI's PublishMenu — an author must not publish via the raw API); a `published:false` draft
 *     only needs `content.edit`
 *   - everything else (drafts, taxonomy, deletes) → `content.edit` */
function actionForChange({ path, content }: WriteChange): Action {
  // `path` is guaranteed canonical here — `writeActionForChanges` fails closed before this runs.
  const overrideAction = PATH_WRITE_ACTION[foldRepoPath(path)]
  if (overrideAction) return overrideAction
  if (
    content !== undefined &&
    parseContentPath(path) &&
    publishesLiveContent(content)
  )
    return 'content.publish'
  return 'content.edit'
}

/** The write permission a commit requires. Fail-closed: the STRONGEST permission any of its changes
 *  needs (by `WRITE_ACTION_RANK`), so nothing can be smuggled in alongside a lower-privilege change.
 *
 *  Transition-aware (#382): beyond the NEW content, a change touching a content path whose
 *  COMMITTED content is live (live-edit, unpublish-by-write, or delete of a live post) also
 *  requires `content.publish` — an author must not be able to silently unpublish or delete a live
 *  post just because `content.edit` lets them write drafts. The committed-state read
 *  (`git.readFile`) is skipped whenever it could not change the outcome: for non-content paths,
 *  when this change's own action already ranks ≥ `content.publish`, or once the running strongest
 *  does (higher ranks imply `content.publish`'s holders by the subset ladder above). */
// Exported as THE shared write-permission seam: history-api.ts's restore route
// derives its gate through this same function (#466) — a restore is a content
// write and must never demand less than the equivalent direct commit would.
export async function writeActionForChanges(
  changes: WriteChange[],
  git: GitPort
): Promise<Action> {
  // #623 fail-closed backstop for DIRECT callers (history-api.ts's restore route calls this
  // function outside `requireWrite`): a non-canonical path means the gate and the adapter would
  // disagree about which file is being written, so demand the STRONGEST action on the ladder
  // rather than guess. `requireWrite` rejects these with a 400 before they ever get here, so this
  // branch is reachable only from a direct call — which is exactly what it exists to protect.
  if (!changes.every((c) => isCanonicalRepoPath(c.path)))
    return 'settings.manage'

  const publishRank = writeActionRank('content.publish')
  let strongest: Action = 'content.edit'
  for (const change of changes) {
    let needed = actionForChange(change)
    const p = change.path
    if (
      writeActionRank(needed) < publishRank &&
      writeActionRank(strongest) < publishRank &&
      parseContentPath(p)
    ) {
      const committed = await git.readFile(p)
      if (committed !== null && publishesLiveContent(committed))
        needed = 'content.publish'
    }
    if (writeActionRank(needed) > writeActionRank(strongest)) strongest = needed
  }
  return strongest
}

/** Authz gate for the write routes: parses the commit body, derives the required action from the
 *  target paths + new content + committed state, and 403s an actor who lacks it. Pairs with
 *  `authMiddleware` (sets the actor / 401s). Hono caches `c.req.json()`, so the handler re-reading
 *  the same body is free. */
function requireWrite(
  git: GitPort,
  changesOf: (body: unknown) => WriteChange[]
) {
  return createMiddleware<{ Variables: { actor: ResolvedActor } }>(
    async (c, next) => {
      let changes: WriteChange[]
      try {
        changes = changesOf(await c.req.json())
      } catch {
        return c.json({ error: 'invalid request body' }, 400)
      }
      // #623: reject non-canonical paths BEFORE any permission derivation or write. A path the
      // gate and the adapter would resolve differently is a malformed request, not a permission
      // question — so this is a 400 for every role, admin included.
      if (!changes.every((ch) => isCanonicalRepoPath(ch.path)))
        return c.json(
          { error: 'path must be canonical and repo-relative' },
          400
        )
      if (!authz.can(c.get('actor'), await writeActionForChanges(changes, git)))
        return c.json({ error: 'forbidden' }, 403)
      await next()
    }
  )
}

/** Capability gate for the git READ routes (#621): 403 when the already-authenticated actor lacks
 *  `action`. Same shape as index-api.ts / forms.ts — `authMiddleware` first (401 for no actor),
 *  this second (403 for the wrong actor). */
function requireCan(action: Action) {
  return createMiddleware<{ Variables: { actor: ResolvedActor } }>(
    async (c, next) => {
      if (!authz.can(c.get('actor'), action))
        return c.json({ error: 'forbidden' }, 403)
      await next()
    }
  )
}

/** A Hono app exposing a GitPort over HTTP (RPC-style, one route per method).
 *  Pure factory — the caller supplies the GitPort, the actor resolver, and the listener (server.ts).
 *
 *  Authz (#362, OWASP A01): /git/* is the repository write API — an ungated `POST /git/commit`
 *  let an anonymous caller rewrite any file in the content repo. The WRITE routes require a write
 *  permission derived from the target paths, the NEW content, AND the COMMITTED state of each
 *  touched path (`writeActionForChanges`):
 *    - `settings.json`           → `settings.manage` (admin only — settings share this primitive and
 *                                  must not be writable by content staff; UAT 2026-07-05).
 *    - a content post going live → `content.publish` — publishing is enforced HERE, server-side, not
 *                                  only in the UI's PublishMenu, so an author (who lacks
 *                                  `content.publish`) cannot publish by POSTing live content directly.
 *                                  A `published: false` draft only needs `content.edit`.
 *    - a change touching a path whose COMMITTED content is already live → `content.publish` (#382:
 *                                  writing `published: false` over a live post, deleting a live
 *                                  post, or any other edit to it is a publish-adjacent action — an
 *                                  author must not be able to silently unpublish or delete a live
 *                                  post just because `content.edit` lets them write drafts).
 *    - everything else            → `content.edit` (Author/Editor/Maintainer/Admin).
 *  Fail-closed: a mixed commit requires the strongest permission any change needs. Path scoping is
 *  otherwise still coarse (taxonomy also rides `content.edit`; a later/Pro increment refines it). The
 *  security-critical properties: an unauthenticated actor cannot write at all, content staff cannot
 *  write admin-only files, non-publishers cannot publish, and non-publishers cannot alter a post that
 *  is already live. The admin's HttpGitPort carries the session cookie (credentials: 'include' via
 *  apiFetch — apps/admin/src/data/Bootstrap.tsx).
 *
 *  The READ routes (#621): `/git/file`, `/git/list` and `/git/diff` require `authMiddleware` +
 *  `content.view`. #362 left every read ungated on a deferral to **#110, which closed without the
 *  follow-up ever landing** — so an unauthenticated caller could enumerate and read EVERY file in
 *  the content repo: unpublished drafts, `settings.json`, the lot. `originGuard` does not cover it
 *  either — its `SAFE_METHODS` short-circuit passes all GETs by design (that guard is CSRF, not
 *  authz). The original justification was also strictly broader than the need it cited: the ONLY
 *  pre-session git read is `seedIfEmpty` (apps/admin/src/data/store.tsx), and it calls
 *  `git.headSha()` — nothing else. So `/git/head` alone stays ungated (a bare commit sha exposes no
 *  repo content) with the bootstrap reason restated on the route itself, and every route that
 *  returns repo content is gated. Zero role regression: `content.view` is in the shared `VIEW` set
 *  held by all four roles (packages/core/src/authz/default-roles.ts).
 *
 *  CORS/origin policy is owned centrally by server.ts (the allowlisted `cors()` +
 *  `originGuard`), not per-factory — a factory-local permissive `cors()` here would
 *  be clobbered onto the response after server.ts's allowlist runs, silently
 *  reopening every route to `*` origins. Tests exercise this app standalone
 *  (same-origin `.fetch()`), so no CORS headers are needed for those to pass. */
export function createGitApi(git: GitPort, resolveActor: ResolveActor) {
  const app = new Hono<{ Variables: { actor: ResolvedActor } }>()
  const auth = authMiddleware(resolveActor)
  // #621: every read that returns repo CONTENT is gated on `content.view` (held by all four
  // roles, so no role loses access — this only closes the unauthenticated hole).
  const canRead = requireCan('content.view')

  // The ONE deliberately ungated route (#621). The admin's `seedIfEmpty`
  // (apps/admin/src/data/store.tsx) calls `git.headSha()` BEFORE a session exists, to decide
  // whether to seed sample drafts; gating it 401s that read and hangs the whole admin on
  // "Loading…" (caught in live UAT under #362). The response is a bare commit sha (or null) — no
  // repo content, no path names — so the exposure is a build-identity fingerprint, not the file
  // enumeration that /git/file and /git/list were. Do NOT add content to this response.
  app.get('/git/head', async (c) => c.json({ sha: await git.headSha() }))

  app.get('/git/file', auth, canRead, async (c) => {
    const path = c.req.query('path')
    if (path === undefined || path === '')
      return c.json({ error: 'path query is required' }, 400)
    return c.json({ content: await git.readFile(path) })
  })

  // Body cap runs FIRST (before auth) so an oversized payload is rejected on content-length without
  // any auth work or a full `c.req.json()` read — a cheap DoS backstop on the write routes.
  const writeBodyLimit = bodyLimit({
    maxSize: GIT_WRITE_MAX_BYTES,
    onError: (c) => c.json({ error: 'payload too large' }, 413)
  })

  app.post(
    '/git/commit',
    writeBodyLimit,
    auth,
    requireWrite(git, (b) => {
      const { path, content } = b as CommitInput
      return typeof path === 'string' ? [{ path, content }] : []
    }),
    async (c) => {
      const body = await c.req.json<CommitInput>()
      // Server-authoritative identity: the session's git author (when known) is stamped over
      // whatever the client's request body claims — never trust the client for who committed
      // (#382). No session identity (e.g. local/no-auth dev) → the body's author is the fallback.
      const author = c.get('actor').gitAuthor ?? body.author
      const { sha } = await git.commitFile({ ...body, author })
      return c.json({ sha })
    }
  )

  app.post(
    '/git/commit-files',
    writeBodyLimit,
    auth,
    requireWrite(git, (b) => {
      const changes = (b as CommitFilesInput).changes
      if (!Array.isArray(changes)) return []
      return changes
        .filter(
          (ch): ch is CommitFilesInput['changes'][number] =>
            typeof ch?.path === 'string'
        )
        .map((ch) => ({
          path: ch.path,
          content: 'content' in ch ? ch.content : undefined
        }))
    }),
    async (c) => {
      const body = await c.req.json<CommitFilesInput>()
      // Server-authoritative identity — see the /git/commit route above (#382).
      const author = c.get('actor').gitAuthor ?? body.author
      const { sha } = await git.commitFiles({ ...body, author })
      return c.json({ sha })
    }
  )

  app.get('/git/list', auth, canRead, async (c) => {
    const prefix = c.req.query('prefix')
    return c.json({ paths: await git.list(prefix) })
  })

  // Tree-to-tree diff between two commits (#450) — gated like the other content
  // reads (#621): the changed-path list leaks the repo's structure and the
  // existence of unpublished entries. Shas are
  // validated to 40-hex so arbitrary strings never reach the adapter; an
  // unknown-but-well-formed sha rejects in the adapter → the 500 envelope,
  // which HttpGitPort surfaces and the index service treats as "diff
  // unavailable → full rescan".
  const SHA40_RE = /^[0-9a-fA-F]{40}$/
  app.get('/git/diff', auth, canRead, async (c) => {
    const from = c.req.query('from')
    const to = c.req.query('to')
    if (
      from === undefined ||
      to === undefined ||
      !SHA40_RE.test(from) ||
      !SHA40_RE.test(to)
    )
      return c.json({ error: 'from and to must be 40-hex commit shas' }, 400)
    return c.json({ changes: await git.diffPaths(from, to) })
  })

  app.onError(apiOnError({ scope: 'git' })) // #291: prod-generic, never err.message
  return app
}
