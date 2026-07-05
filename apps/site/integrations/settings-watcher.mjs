// Dev-only (#361): astro dev caches the route matrix and only invalidates it when a WATCHED
// file changes. settings.json lives at the content-repo root (a sibling of content/, outside
// the watched content dir), so route-affecting settings — permalink patterns, reading.homepage —
// stayed stale until the next content edit. Watch the file explicitly and restart the dev server
// on change: heavy but correct, and settings saves are rare. `astro build` is unaffected
// (everything is computed fresh per build).
import { existsSync } from 'node:fs'
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
        if (!file || !existsSync(file)) return
        server.watcher.add(file)
        const onChange = (path) => {
          if (path !== file) return
          logger.info('settings.json changed — restarting so routes pick it up')
          void server.restart()
        }
        server.watcher.on('change', onChange)
      }
    }
  }
}
