// Dev-only (#361): astro dev caches the route matrix and only invalidates it when a WATCHED
// file changes. settings.json lives at the content-repo root (a sibling of content/, outside
// the watched content dir), so route-affecting settings — permalink patterns, reading.homepage —
// stayed stale until the next content edit. Watch the file explicitly and restart the dev server
// on change: heavy but correct, and settings saves are rare. `astro build` is unaffected
// (everything is computed fresh per build).
import { dirname, join } from 'node:path'

/** The settings.json to watch, derived from SETU_CONTENT_DIR (content dir → sibling file).
 *  Env-only on purpose: this .mjs runs at config time and can't reach src/lib/content-root.ts's
 *  fuller resolution; the dev stack always sets the env, and without it there is nothing
 *  sensible to watch. Exported for unit tests. */
export function settingsWatchPath(env = process.env) {
  const contentDir = env.SETU_CONTENT_DIR
  if (!contentDir) return null
  return join(dirname(contentDir), 'settings.json')
}

export function settingsWatcher() {
  return {
    name: 'setu:settings-watcher',
    hooks: {
      'astro:server:setup': ({ server, logger }) => {
        const file = settingsWatchPath()
        if (!file) return
        // Watch the DIRECTORY, not the file, and handle `add` as well as `change`. The seeded dev
        // sandbox contains content/ + url-map.json + redirects.json and NO settings.json (see
        // scripts/content-sandbox.mjs), so the file does not exist when this hook runs and the
        // API creates it on the owner's FIRST save. Watching the file meant the first save — the
        // common case on a fresh sandbox — never restarted anything, leaving #361 live behind a
        // green "Saved" toast. Enforced by apps/site/test/settings-watcher-dev.test.ts, which
        // starts from a sandbox with no settings.json and creates one.
        server.watcher.add(dirname(file))
        const onWrite = (path) => {
          if (path !== file) return
          server
            .restart()
            .then(() =>
              // Logged AFTER the restart resolves: announcing it beforehand printed a success
              // line over a restart that could still reject (strictPort is set, so a momentarily
              // held port rejects out of server.restart()), which is the failure this watcher
              // exists to prevent, wearing a message saying it was fixed (CLAUDE.md §4 #22).
              logger.info(
                'settings.json changed — restarted so routes pick it up'
              )
            )
            .catch((err) =>
              logger.error(
                `settings.json changed but the dev server could not restart — routes are STALE, restart it by hand: ${err instanceof Error ? err.message : String(err)}`
              )
            )
        }
        server.watcher.on('change', onWrite)
        server.watcher.on('add', onWrite)
      }
    }
  }
}
