// Is an `astro dev` serving this site project right now? — the staging preflight (#1200).
//
// A build and a dev server cannot share an Astro project: `astro build` rewrites
// `.astro/content-modules.mjs` and the generated types underneath a running `astro dev`, which then
// answers every content route with UnknownContentCollectionError (#1087). The api's Rebuild path
// already refuses for that reason (`devServerHolding` in apps/api/src/deploy-wiring.ts); `pnpm
// staging` builds `apps/site` too, and did not. This is the same probe restated in plain JS,
// because a .mjs script cannot import the TS module; the two are held to the same answers by
// apps/api/test/astro-dev-lock-parity.test.ts, and this file's own branches by
// scripts/astro-dev-lock.test.mjs.
//
// The signal is Astro's dev lockfile `<siteDir>/.astro/dev.json` (`{ pid, port, url, … }`). It
// degrades OPEN on anything it cannot positively read as a live dev server — no file, not JSON, no
// positive integer pid, or a pid that is not running — so a stale lockfile never blocks a build.
// Non-positive pids are rejected before the probe: pid 0 means "our own process group".

import { readFileSync } from 'node:fs'
import path from 'node:path'

const probe = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The pid of the live `astro dev` holding `siteDir`, or null. */
export function astroDevPid(siteDir, alive = probe) {
  if (siteDir === null || siteDir === undefined) return null
  let parsed
  try {
    parsed = JSON.parse(
      readFileSync(path.join(siteDir, '.astro', 'dev.json'), 'utf-8')
    )
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const pid = parsed.pid
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null
  return alive(pid) ? pid : null
}
