import { randomBytes } from 'node:crypto'
import {
  ensureLocalOwner,
  type AuthInstance,
  type LocalOwnerIdentity
} from '@setu/auth'
import { writeHandshakeFile } from './handshake-file'

export interface BuildLocalTokenOptionsArgs {
  /** Repo dir whose `.setu/handshake-url` holds the persisted recovery link (server.ts:
   *  `SETU_REPO_DIR ?? cwd`). */
  dir: string
  /** Admin SPA origin the handshake URL points at (server.ts: `SETU_ADMIN_ORIGIN ?? :5173`). */
  adminOrigin: string
  /** Forward reference to the auth instance: `auth` doesn't exist yet when this provider is
   *  built (createAuth itself takes the result as an option), so the caller passes a getter that
   *  is only invoked per-request (on an actual exchange POST), by which time boot has finished
   *  and the reference is populated — never called during construction itself. */
  getAuth: () => AuthInstance
  /** Owner identity for `ensureLocalOwner` (#248 Task 7) — resolved ONCE by the caller (server.ts
   *  via `resolveGitIdentity()`, "read git config once at boot"), not on every exchange. */
  identity: LocalOwnerIdentity
  /** Injectable handshake-file writer — tests drive the persist-failure/self-heal path with a
   *  throwing writer; the default is the real `writeHandshakeFile` and MUST stay the production
   *  path. Synchronous by contract (see the rotation invariant below). */
  persist?: (dir: string, url: string) => void
}

/** Loopback token handshake provider (local topology only, #248 Task 4; rotation + persistence
 *  #386): the process that boots the api mints a token; the admin exchanges it at POST
 *  /api/auth/local/exchange (see @setu/auth's localToken plugin) for a completely normal Better
 *  Auth session. Closure state here holds the CURRENT token — a valid, unused one always exists.
 *
 *  ## Invariants
 *
 *  - `consume()` re-mints SYNCHRONOUSLY: the plugin calls it before any await, which is what
 *    keeps single-use race-free — an async rotation would open a window where two exchanges both
 *    match the same token. The persist attempt inside it is synchronous too and never throws
 *    outward: a disk hiccup must not turn a successful exchange into a 500 AFTER the token was
 *    already burned.
 *  - `getToken()` returning non-null reflects a stable topology-level fact ("local-token
 *    capability exists" — the plugin 404s when it's null); the VALUE it returns changes on every
 *    consume. Single-use is guaranteed by that rotation (a consumed token no longer matches),
 *    plus the plugin's own last-consumed-token fallback — see @setu/auth's local-token-plugin.ts.
 *  - Self-healing persistence: when a persist fails, `pendingPersist` is set and the failure is
 *    only logged — the on-disk `.setu/handshake-url` is then STALE (it still holds the consumed,
 *    dead token). Because the plugin calls `getToken()` at the start of EVERY exchange attempt —
 *    including attempts that will 401 on that dead token — `getToken()` retries the persist while
 *    the flag is set, clearing it on success. So a locked-out owner's own failed attempt with the
 *    stale link rewrites the file once the disk condition clears; before #386-review this state
 *    was permanent until restart (nothing else ever rewrote the file: failed exchanges 401 before
 *    consume()).
 *
 *  `persistUrl` is exposed for the ONE boot-time write server.ts performs after logging the
 *  handoff URL; every rotation rewrites the file from inside `consume()`. */
export function buildLocalTokenOptions(args: BuildLocalTokenOptionsArgs) {
  const { dir, adminOrigin, getAuth, identity } = args
  const persist = args.persist ?? writeHandshakeFile
  let token = randomBytes(32).toString('base64url')
  // True while the LAST persist attempt failed — the file on disk is stale until a retry lands.
  let pendingPersist = false
  const persistUrl = () => {
    try {
      persist(dir, `${adminOrigin}/#setu-token=${token}`)
      pendingPersist = false
    } catch (err) {
      pendingPersist = true
      console.error('[auth] failed to write .setu/handshake-url', err)
    }
  }
  return {
    token, // the INITIAL token, returned ONLY so the caller can log the boot handoff URL; never logged elsewhere.
    persistUrl,
    getToken: () => {
      // Self-heal seam (see the module doc): every exchange attempt passes through here first,
      // so a previously failed persist gets retried by the very attempt a locked-out owner makes
      // with the stale on-disk link.
      if (pendingPersist) persistUrl()
      return token
    },
    consume: () => {
      // SYNCHRONOUS rotation — no await between re-mint and the plugin's post-consume awaits.
      token = randomBytes(32).toString('base64url')
      persistUrl()
    },
    localUserId: (): Promise<string> => ensureLocalOwner(getAuth(), identity)
  }
}
