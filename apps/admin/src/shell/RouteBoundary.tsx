import { Component, Suspense, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { PageBody } from './PageBody'

/** Loading treatment for a route whose JS chunk is still in flight (#597).
 *  Mirrors the real screen frame — PageHeader's border/gutters/height, then a
 *  PageBody of block skeletons — so the swap to the loaded screen doesn't shift
 *  the layout. Same `Skeleton` primitive every screen's own loading state uses
 *  (UsersScreen, MediaGrid, TagList), so a route change never flashes blank. */
export function RouteFallback() {
  return (
    <div aria-busy="true" aria-label="Loading screen">
      <header className="flex items-end justify-between gap-4 border-b border-border bg-background px-[30px] pt-[22px] pb-4">
        <Skeleton className="h-[26px] w-52" />
        <Skeleton className="h-9 w-28" />
      </header>
      <PageBody className="space-y-4">
        <Skeleton className="h-9 w-full max-w-sm" />
        <Skeleton className="h-56 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </PageBody>
    </div>
  )
}

/** Honest failure for a chunk that never arrives (#597). A lazy route rejects for
 *  real reasons — the network dropped, or a redeploy replaced the hashed chunk this
 *  still-open tab is asking for — and React's default for a rejected lazy import is
 *  an unmounted tree, i.e. a permanently blank screen. Catch it and say so, with the
 *  one action that actually fixes the stale-deploy case: a full reload, which
 *  re-fetches index.html and therefore the current chunk names. */
class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <PageBody className="mx-auto max-w-lg pt-16 text-center">
        <h2 className="text-[19px] font-bold tracking-tight text-foreground">
          This screen couldn&apos;t be loaded
        </h2>
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
          Part of the admin failed to download. That usually means the
          connection dropped, or Setu was updated while this tab was open.
          Reloading picks up the current version.
        </p>
        <Button className="mt-6" onClick={() => window.location.reload()}>
          Reload the admin
        </Button>
      </PageBody>
    )
  }
}

/** Wraps the route outlet in the pair every lazily-loaded screen needs: a Suspense
 *  with a real loading frame, and an error boundary so a failed chunk fetch surfaces
 *  instead of blanking. Keyed on pathname so navigating elsewhere clears a previous
 *  route's failure — otherwise one bad chunk would poison the whole session. */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <RouteErrorBoundary key={pathname}>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </RouteErrorBoundary>
  )
}
