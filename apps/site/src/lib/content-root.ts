import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Resolve the content-repo root — the directory that holds `content/`, alongside its siblings
 *  `settings.json`, `theme-options.json`, and `taxonomy/`.
 *
 *  - `SETU_CONTENT_DIR` (set in dev + prod) points at the `content/` directory, so the root is its
 *    parent.
 *  - Otherwise, walk up from the current working directory to the first ancestor containing a
 *    `content/` directory. This works whether `astro build` runs from `apps/site/` or the repo root,
 *    and — unlike `import.meta.url` — is unaffected by where Astro bundles prerender chunks (which
 *    silently broke the old relative-path resolution). See #80.
 *  - Best-effort fallback: the cwd.
 *
 *  Node-only (fs): runs at build / prerender time, never on the edge request path.
 *  `from` (the directory to start the walk from) is injectable for testing; it defaults to cwd. */
export function contentRepoRoot(from: string = process.cwd()): string {
  const contentDir = process.env.SETU_CONTENT_DIR
  if (contentDir) return join(contentDir, '..')
  let dir = from
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'content'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return from
}
