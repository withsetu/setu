/// <reference types="vite/client" />

// Custom env vars read via `import.meta.env.*` had no declaration anywhere in the repo —
// every call site worked around it with a manual `as string | undefined` cast (12+ sites
// across screens/, editor/, lib/). This is the missing declaration; the now-redundant
// casts are cleaned up alongside (typescript-eslint's `no-unnecessary-type-assertion`
// flags a cast that no longer changes the expression's type).
interface ImportMetaEnv {
  /** The @setu/api origin (set by `pnpm dev`; see root package.json). */
  readonly VITE_SETU_API?: string
  /** The @setu/site origin, used for "View on site" links. */
  readonly VITE_SETU_SITE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Git branch of the checkout this bundle was served from, injected by vite (#779).
 *  Empty string in `vite build` output — the dev badge is dev-only and carries no branch or
 *  path information into a production bundle. */
declare const __SETU_DEV_BRANCH__: string
