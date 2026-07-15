import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChangedPath, DeployState } from '@setu/core'

const execFileP = promisify(execFile)

/** Real (Node-topology) implementations of createDeployApi's injected seams (#209).
 *  Kept out of server.ts so the hot file only gains a mount, and out of deploy.ts so
 *  the route module stays process-free and unit-testable. */

/** Where the Astro site project lives. Explicit via SETU_SITE_DIR; in the monorepo dev
 *  stack the api runs from apps/api so ../site is the default. Null (no dir found) =
 *  the rebuild capability is off — the honest 409 path, e.g. a bare content-repo VPS. */
export function resolveSiteDir(
  env: NodeJS.ProcessEnv,
  cwd: string
): string | null {
  const explicit = env.SETU_SITE_DIR
  if (explicit !== undefined && explicit !== '')
    return existsSync(join(explicit, 'package.json')) ? resolve(explicit) : null
  const sibling = resolve(cwd, '../site')
  return existsSync(join(sibling, 'package.json')) ? sibling : null
}

export function readDeployState(repoDir: string): DeployState | null {
  try {
    const raw = readFileSync(join(repoDir, '.setu', 'deploy.json'), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<DeployState>
    if (typeof parsed.sha !== 'string' || typeof parsed.at !== 'string')
      return null
    return { sha: parsed.sha, at: parsed.at, mode: parsed.mode ?? 'static' }
  } catch {
    return null
  }
}

export function writeDeployState(repoDir: string, state: DeployState): void {
  writeFileSync(
    join(repoDir, '.setu', 'deploy.json'),
    JSON.stringify(state, null, 2) + '\n'
  )
}

/** Git HEAD of the content repo. execFile (no shell), fixed args — the
 *  auth/git-identity.ts precedent. */
export async function gitHeadSha(repoDir: string): Promise<string> {
  const { stdout } = await execFileP('git', [
    '-C',
    repoDir,
    'rev-parse',
    'HEAD'
  ])
  return stdout.trim()
}

/** Paths changed between a past sha and HEAD, with added-ness. `--name-status` lines
 *  are `M\tpath`, `A\tpath`, `D\tpath`, or `R<score>\told\tnew`; a rename's new path
 *  counts as added (it was never live under that path), deletions still count toward
 *  the pending set (removing a page is a pending change too). */
export async function gitChangedPaths(
  repoDir: string,
  sinceSha: string
): Promise<ChangedPath[]> {
  const { stdout } = await execFileP('git', [
    '-C',
    repoDir,
    'diff',
    '--name-status',
    `${sinceSha}..HEAD`
  ])
  const out: ChangedPath[] = []
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const parts = line.split('\t')
    const kind = parts[0] ?? ''
    if (kind.startsWith('R')) {
      // rename: old path is gone (a change), new path never existed on the live site
      if (parts[1]) out.push({ path: parts[1], added: false })
      if (parts[2]) out.push({ path: parts[2], added: true })
    } else if (parts[1]) {
      out.push({ path: parts[1], added: kind === 'A' })
    }
  }
  return out
}

/** Runs the site build (`npm run build` semantics via the configured command) in the
 *  site dir, with the content sandbox exported the same way `pnpm dev` wires the site
 *  process. Rejects with the log tail attached on failure. Long-running by design —
 *  createDeployApi runs it as a fire-and-forget job. */
export function makeBuildRunner(opts: {
  siteDir: string
  repoDir: string
  env: NodeJS.ProcessEnv
}): () => Promise<void> {
  const { siteDir, repoDir, env } = opts
  const command = env.SETU_BUILD_COMMAND ?? 'pnpm build'
  const [file, ...args] = command.split(' ') as [string, ...string[]]
  return () =>
    new Promise<void>((resolvePromise, reject) => {
      const child = spawn(file, args, {
        cwd: siteDir,
        env: {
          ...env,
          SETU_CONTENT_DIR: env.SETU_CONTENT_DIR ?? join(repoDir, 'content')
        },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let tail = ''
      const keep = (chunk: Buffer) => {
        tail = (tail + chunk.toString()).slice(-4096)
      }
      child.stdout.on('data', keep)
      child.stderr.on('data', keep)
      child.on('error', (e) => reject(Object.assign(e, { logTail: tail })))
      child.on('exit', (code) => {
        if (code === 0) resolvePromise()
        else
          reject(
            Object.assign(
              new Error(`build exited with code ${code ?? 'null'}`),
              {
                logTail: tail
              }
            )
          )
      })
    })
}
