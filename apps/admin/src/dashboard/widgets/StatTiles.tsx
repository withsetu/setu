import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

function Stat({
  value,
  label,
  hint,
  emphasis
}: {
  value: number
  label: string
  /** Second muted line — used by Staged to say "pending deploy" out loud. */
  hint?: string
  emphasis?: boolean
}) {
  return (
    <div>
      <div className={`text-2xl font-medium ${emphasis ? 'text-warning' : ''}`}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint !== undefined && (
        <div className="text-xs text-muted-foreground/80">{hint}</div>
      )}
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

/** At-a-glance counts, each one a link to the list filtered to exactly what it
 *  counted (#579 supplied the missing status filters).
 *
 *  #598: Live and Staged are separate tiles. A single "Published" tile summed
 *  both, which reads as "on the site" — but a staged entry is committed and NOT
 *  yet deployed, and blurring that is precisely the saved≠live confusion Setu
 *  refuses to ship (card #7). Live/Staged/Drafts count post + page together
 *  (unchanged from #587) while linking to the posts list, matching how the
 *  Drafts tile has always behaved; #604 tracks making that scope explicit. */
export function StatTiles({
  posts,
  pages,
  live,
  staged,
  drafts,
  loading = false
}: {
  posts: number
  pages: number
  live: number
  staged: number
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
      {/* 5 tiles: 2 columns on narrow, 3 from sm up — a 2-col grid would strand
          Drafts alone on a third row. */}
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {loading ? (
          <>
            <StatSkeleton label="Posts" />
            <StatSkeleton label="Pages" />
            <StatSkeleton label="Live" />
            <StatSkeleton label="Staged" />
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
            <Link to="/posts?status=live" className={tileLink}>
              <Stat value={live} label="Live" hint="On the site" />
            </Link>
            {/* Emphasised like Drafts: staged entries are unfinished business —
                work that needs a deploy before anyone can see it. */}
            <Link to="/posts?status=staged" className={tileLink}>
              <Stat
                value={staged}
                label="Staged"
                hint="Pending deploy"
                emphasis
              />
            </Link>
            <Link to="/posts?status=draft" className={tileLink}>
              <Stat
                value={drafts}
                label="Drafts"
                hint="Not published"
                emphasis
              />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  )
}
