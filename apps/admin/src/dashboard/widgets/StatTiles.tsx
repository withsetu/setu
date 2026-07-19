import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUS_FILTER_MENU } from '@/lib/status-filter-vocab'

/** Label + hint + destination for the three status tiles, taken from the SAME
 *  list the content list's status filter renders (#598 UAT: the tiles and the
 *  menu had drifted into two vocabularies for one concept). The order there is
 *  Live → Staged → Drafts, which is the order the tiles want too. */
const [LIVE, STAGED, DRAFTS] = STATUS_FILTER_MENU as readonly [
  (typeof STATUS_FILTER_MENU)[number],
  (typeof STATUS_FILTER_MENU)[number],
  (typeof STATUS_FILTER_MENU)[number]
]

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
 *  refuses to ship (card #7).
 *
 *  #604 — THE RULE: the number on a tile and the number on the page it opens
 *  must be the same number. Live/Staged/Drafts count post + page together but
 *  used to link to /posts, which can only ever show posts: UAT found a Staged
 *  tile reading 19 open a list of 5, with 14 staged pages unreachable. They now
 *  link to /content, the cross-collection list — the destination was widened to
 *  match the count rather than the count narrowed to match the destination,
 *  because page-level live/staged status is exactly what a glance is for. The
 *  equality is pinned per-tile in stat-tiles.test.tsx by running each href's
 *  filter through the real query engine. */
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
            <StatSkeleton label={LIVE.label} />
            <StatSkeleton label={STAGED.label} />
            <StatSkeleton label={DRAFTS.label} />
          </>
        ) : (
          <>
            <Link to="/posts" className={tileLink}>
              <Stat value={posts} label="Posts" />
            </Link>
            <Link to="/pages" className={tileLink}>
              <Stat value={pages} label="Pages" />
            </Link>
            <Link to={`/content?status=${LIVE.value}`} className={tileLink}>
              <Stat value={live} label={LIVE.label} hint={LIVE.hint} />
            </Link>
            {/* Emphasised like Drafts: staged entries are unfinished business —
                work that needs a deploy before anyone can see it. */}
            <Link to={`/content?status=${STAGED.value}`} className={tileLink}>
              <Stat
                value={staged}
                label={STAGED.label}
                hint={STAGED.hint}
                emphasis
              />
            </Link>
            {/* #611: draft + unpublished. 'unpublished' is what a committed-hidden
                entry becomes once the site has been deployed at all, so a
                draft-only tile emptied itself on first deploy.
                The hint is "Not published", not "Not on the site" (#598 UAT):
                a STAGED entry is also not on the site, so location can't be what
                separates these tiles — intent is. */}
            <Link to={`/content?status=${DRAFTS.value}`} className={tileLink}>
              <Stat
                value={drafts}
                label={DRAFTS.label}
                hint={DRAFTS.hint}
                emphasis
              />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  )
}
