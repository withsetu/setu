import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

function Stat({
  value,
  label,
  emphasis
}: {
  value: number
  label: string
  emphasis?: boolean
}) {
  return (
    <div>
      <div className={`text-2xl font-medium ${emphasis ? 'text-warning' : ''}`}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

/** Loading placeholder shaped like a Stat: skeleton number, real label — the shell
 *  paints instantly and nothing shifts when the count lands (#572). The skeleton
 *  matches the value line box (text-2xl line-height = h-8). */
function StatSkeleton({ label }: { label: string }) {
  return (
    <div>
      <div className="flex h-8 items-center">
        <Skeleton className="h-6 w-10" />
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

// Same treatment as the original Drafts link — whole tile clickable, subtle hover.
const tileLink = 'rounded hover:bg-accent'

export function StatTiles({
  posts,
  pages,
  published,
  drafts,
  loading = false
}: {
  posts: number
  pages: number
  published: number
  drafts: number
  loading?: boolean
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">
          At a glance
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {loading ? (
          <>
            <StatSkeleton label="Posts" />
            <StatSkeleton label="Pages" />
            <StatSkeleton label="Published" />
            <StatSkeleton label="Drafts" />
          </>
        ) : (
          <>
            <Link to="/posts" className={tileLink}>
              <Stat value={posts} label="Posts" />
            </Link>
            <Link to="/pages" className={tileLink}>
              <Stat value={pages} label="Pages" />
            </Link>
            {/* #572: the list has no `published` status filter (LifecycleState is
                draft/staged/live/unpublished; this count = staged + live), so the
                closest honest target is the plain posts list. */}
            <Link to="/posts" className={tileLink}>
              <Stat value={published} label="Published" />
            </Link>
            <Link to="/posts?status=draft" className={tileLink}>
              <Stat value={drafts} label="Drafts" emphasis />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  )
}
