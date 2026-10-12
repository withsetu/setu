import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LANE_RE = /^[a-z0-9][a-z0-9-]*$/i

/** The file name under `.setu/` (#1213). `pnpm dev` lanes share one sandbox, so the launcher
 *  passes each api its lane (SETU_DEV_LANE) and each writes `handshake-url.<lane>`; with no lane
 *  it is the shared `handshake-url`. The lane becomes part of a path, so it must be one safe
 *  segment (the launcher's own rule, scripts/dev-lanes.mjs assertValidLaneName). Restates
 *  handshakeFileFor in scripts/dev-lanes.mjs; apps/api/test/handshake-file.test.ts holds the two
 *  equal. */
export function handshakeFileName(lane?: string): string {
  if (lane === undefined) return 'handshake-url'
  if (!LANE_RE.test(lane))
    throw new Error(
      `invalid lane name ${JSON.stringify(lane)} for the handshake file — must match ${String(LANE_RE)}`
    )
  return `handshake-url.${lane}`
}

/** #386: persists the local-mode handshake URL to the well-known path
 *  `${dir}/.setu/handshake-url` (or `handshake-url.<lane>`, #1213) (full URL + trailing newline) so a locked-out owner can always
 *  recover a valid login link from disk instead of restarting the API and grepping logs. Written
 *  at boot and rewritten on EVERY token rotation — local mode only (the caller, server.ts, is
 *  responsible for never calling this in other modes).
 *
 *  The file contains a live credential, so it is created with mode 0600 — and explicitly
 *  chmod'd on every write, because `writeFileSync`'s `mode` only applies at file CREATION: a
 *  pre-existing looser file (older writer, manual copy) must be tightened on rewrite, not left
 *  world-readable. Synchronous throughout: the rotation path (`consume()` in server.ts) must not
 *  await between minting the new token and persisting it. */
export function writeHandshakeFile(
  dir: string,
  url: string,
  lane?: string
): void {
  const setuDir = join(dir, '.setu')
  // server.ts mkdirs this at boot; re-ensure defensively so a rotation can't fail because the
  // directory was removed mid-run.
  mkdirSync(setuDir, { recursive: true })
  const file = join(setuDir, handshakeFileName(lane))
  writeFileSync(file, `${url}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
}
