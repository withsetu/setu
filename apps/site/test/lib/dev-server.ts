// Shared `astro dev` harness for the suites that must exercise the DEV path (#613, #1018).
//
// Extracted from dev-root-block.test.ts, which learned all of this the hard way; the rationale
// below is why every one of these steps exists and why none of them is incidental.
//
// The dev server runs in a DEDICATED child Node process, never via an in-suite
// `import { dev } from 'astro'` (#699). Two independent reasons:
//
//  1. astro 7.1 restructured the content-layer data store (the `collectionStorage` refactor,
//     withastro/astro#17296). Under vitest the suite's `astro` import and astro's own SSR module
//     runner resolve into two different vite-node module graphs, so the store the request handler
//     reads is a distinct, EMPTY instance from the one the sync populated — every content page
//     404s.
//  2. astro 7.1's dev content-layer branches on `process.env.VITEST` directly, leaving the SSR
//     store unpopulated when it is set.
//
// Both mean a green in-process suite would prove nothing about the server a developer runs. So
// the child is spawned with the vitest/vite-injected env stripped, and sees exactly the
// environment `astro dev` would.

import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Env keys vitest/vite inject that must NOT leak into the child dev server. `VITEST` flips
 *  astro's dev content-layer into the mode that leaves the SSR store empty; the vite
 *  `import.meta.env` mirror (DEV/PROD/SSR/MODE/BASE_URL), the other VITEST_ and TINYPOOL markers,
 *  and vitest's NODE_PATH override are stripped so the child sees a real-dev environment. */
const VITEST_ENV_KEYS = [
  'VITEST',
  'VITEST_MODE',
  'VITEST_POOL_ID',
  'VITEST_WORKER_ID',
  'TINYPOOL_WORKER_ID',
  'TEST',
  'DEV',
  'PROD',
  'SSR',
  'MODE',
  'BASE_URL',
  'NODE_PATH'
]

export const siteAppDir = fileURLToPath(new URL('../..', import.meta.url))
const serverEntry = fileURLToPath(new URL('../dev-server.mjs', import.meta.url))

export interface DevServer {
  origin: string
  /** Everything the child wrote to stdout/stderr — include it in failure messages. */
  log: () => string
  stop: () => Promise<void>
}

/** Spawn `astro dev` on an OS-chosen port and resolve once it reports one.
 *  `extraEnv` is merged over the cleaned environment (e.g. SETU_CONTENT_DIR). */
export async function startDevServer(
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<DevServer> {
  const env = { ...process.env }
  for (const k of VITEST_ENV_KEYS) delete env[k]
  Object.assign(env, extraEnv)

  // `detached` puts the child in its own process group so teardown can reap the whole tree
  // (Vite's esbuild service, etc.) with a single group-signal.
  const child: ChildProcess = spawn(process.execPath, [serverEntry], {
    cwd: siteAppDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env
  })

  let childLog = ''
  const log = () => childLog

  const port = await new Promise<number>((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`dev server never reported a port:\n${childLog}`)),
      90_000
    )
    child.stdout?.on('data', (d) => {
      childLog += d.toString()
      const m = childLog.match(/PORT=(\d+)/)
      if (m) {
        clearTimeout(deadline)
        resolve(Number(m[1]))
      }
    })
    child.stderr?.on('data', (d) => (childLog += d.toString()))
    child.on('exit', (code) => {
      clearTimeout(deadline)
      reject(new Error(`dev server exited early (${code}):\n${childLog}`))
    })
  })

  const stop = async () => {
    if (child.pid && child.exitCode === null) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        /* already gone */
      }
      await new Promise((r) => setTimeout(r, 300))
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* reaped */
      }
    }
  }

  return { origin: `http://localhost:${port}`, log, stop }
}

/** Poll `url` until `predicate` holds, or throw with the child's log.
 *
 *  Polling rather than a fixed sleep is the point: `dev()` resolves when the server is
 *  listening, but the content-layer sync and the first-request compile both lag the first HTTP
 *  accept. A fixed sleep would either be flaky or slow, and — worse for #1018, where the whole
 *  failure mode is SILENCE — a too-short sleep would read as "the change didn't propagate" when
 *  it simply hadn't yet. */
export async function waitForResponse(
  url: string,
  predicate: (res: Response, body: string) => boolean,
  opts: { timeoutMs?: number; describe: string; log?: () => string }
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const deadline = Date.now() + timeoutMs
  let lastStatus = 'never responded'
  for (;;) {
    try {
      const res = await fetch(url)
      const body = await res.text()
      if (predicate(res, body)) return
      lastStatus = `last status ${res.status}`
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for ${opts.describe} at ${url} ` +
          `(${lastStatus})\n${opts.log?.() ?? ''}`
      )
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}
