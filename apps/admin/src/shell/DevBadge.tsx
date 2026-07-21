import { Badge } from '@/components/ui/badge'

// Dev-only tab identifier (#779). With several worktrees running admin dev servers, every tab is
// `localhost:<port>` and they are indistinguishable at a glance — one that says
// `editor-focus-757-778 · :5183` identifies itself.
//
// The branch cannot be read in the browser, so vite injects it as `__SETU_DEV_BRANCH__` at config
// time (apps/admin/vite.config.ts) — and injects the EMPTY STRING for `vite build`, so no branch
// or path information exists in a production bundle even before the call site is
// dead-code-eliminated by its `import.meta.env.DEV` guard in AppSidebar.
// `typeof` guard, not a bare read: an embedder that builds this app with its own vite config
// (no `define`) would otherwise hit a ReferenceError at render — a white screen for a debug
// affordance. Missing injection degrades to "no badge".
const BUILD_BRANCH =
  typeof __SETU_DEV_BRANCH__ === 'string' ? __SETU_DEV_BRANCH__ : ''

export function DevBadge({
  branch = BUILD_BRANCH,
  port = typeof window === 'undefined' ? '' : window.location.port
}: {
  branch?: string
  port?: string
} = {}) {
  if (!branch) return null
  const label = port ? `${branch} · :${port}` : branch
  return (
    <Badge
      variant="outline"
      role="note"
      aria-label={`Dev build: ${label}`}
      title={`Dev server — branch ${branch}${port ? ` on port ${port}` : ''}`}
      className="mt-1 max-w-full justify-start border-dashed font-mono font-normal text-muted-foreground"
    >
      <span className="truncate">{label}</span>
    </Badge>
  )
}
