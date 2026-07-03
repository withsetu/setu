import { execFileSync } from 'node:child_process'

export interface LocalOwnerIdentity {
  email: string
  name: string
}

const FALLBACK: LocalOwnerIdentity = { email: 'owner@localhost', name: 'Owner' }

function defaultExec(cmd: string): string {
  // execFileSync (no shell) — the args are hardcoded literals, but keeping the shell out of the
  // picture entirely means this stays injection-free even if a caller ever parameterizes it.
  const [file = 'git', ...args] = cmd.split(' ')
  return execFileSync(file, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
}

/** Resolves the identity to use for the local-topology owner account (fed into
 *  `ensureLocalOwner`), from `git config user.email` / `user.name` — the same identity the
 *  developer already committed as, on the machine running `pnpm dev`.
 *
 *  Never crashes boot over this: `git config` throws (no git installed, not inside a repo, or the
 *  key is simply unset) in the common case of a from-scratch install with no global git identity
 *  configured yet — each field falls back independently to `owner@localhost`/`Owner` rather than
 *  the whole lookup failing together, and every failure is swallowed here rather than propagated.
 *
 *  `exec` is injectable (defaults to a real `child_process.execSync` call) purely so tests don't
 *  need a real git binary / configured identity on the CI machine running this suite. */
export function resolveGitIdentity(opts?: { exec?: (cmd: string) => string }): LocalOwnerIdentity {
  const exec = opts?.exec ?? defaultExec
  const read = (cmd: string): string | null => {
    try {
      const out = exec(cmd).trim()
      return out === '' ? null : out
    } catch {
      return null
    }
  }
  return {
    email: read('git config user.email') ?? FALLBACK.email,
    name: read('git config user.name') ?? FALLBACK.name,
  }
}
