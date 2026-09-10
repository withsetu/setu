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

/**
 * Why a rebuild must not run right now, or null when it may — the `buildBlocked` seam (#1087).
 *
 * A build and a dev server cannot share an Astro project. Astro derives its dot-directory from
 * the project root and nothing else (`astro/dist/core/config/settings.js`,
 * `const dotAstroDir = new URL(".astro/", config.root)`), so `cacheDir`/`outDir` cannot separate
 * them: `astro build` rewrites `.astro/content-modules.mjs` and the generated types underneath a
 * running `astro dev`, which then answers every content route with
 * `UnknownContentCollectionError: Unexpected error while rendering`. In the monorepo dev stack
 * `resolveSiteDir` returns `apps/site` — exactly the dir `pnpm dev` is serving — so a Publish
 * from the admin took the dev site down while reporting success.
 *
 * Nothing is lost by refusing: `astro dev` re-reads content live, so a rebuild there changes
 * nothing a reader would see (CLAUDE.md §1).
 *
 * The signal is Astro's own dev lockfile, `<root>/.astro/dev.json`
 * (`astro/dist/core/dev/lockfile.js`), holding `{ pid, port, url, background, startedAt }`. That
 * module is internal, so this reads the file rather than importing it — and therefore degrades
 * OPEN on anything it cannot positively read as a live dev server: no file, unparseable, no
 * numeric pid, or a pid that is not running. A real Node deployment has no such file at all, so
 * this guard can never block one; the cost of the fail-open direction is a missed block if Astro
 * changes the format, not a deployment that cannot build.
 *
 * `process.kill(pid, 0)` only probes — signal 0 delivers nothing. Non-positive pids are rejected
 * before the probe: pid 0 means "every process in our group" on POSIX, and this file is writable
 * by anyone with repo access.
 *
 * The returned reason reaches the admin UI, so it names the pid and no path.
 * Branches pinned by apps/api/test/deploy-wiring.test.ts.
 */
export function devServerHolding(siteDir: string | null): string | null {
  if (siteDir === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(
      readFileSync(join(siteDir, '.astro', 'dev.json'), 'utf-8')
    )
  } catch {
    return null // no lockfile, or not JSON — not a dev server we can identify
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const pid = (parsed as { pid?: unknown }).pid
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0)
  } catch {
    return null // stale lockfile from a dev server that has exited
  }
  return (
    `An Astro dev server (pid ${pid}) is running in this site project, and a build would ` +
    'overwrite the caches it is serving from. Stop it and try again — in dev the site already ' +
    'reflects published content, so no rebuild is needed there.'
  )
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
