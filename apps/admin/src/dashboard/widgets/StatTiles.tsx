import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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

export function StatTiles({
  posts,
  pages,
  published,
  drafts
}: {
  posts: number
  pages: number
  published: number
  drafts: number
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">
          At a glance
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <Stat value={posts} label="Posts" />
        <Stat value={pages} label="Pages" />
        <Stat value={published} label="Published" />
        <Link to="/posts?status=draft" className="rounded hover:bg-accent">
          <Stat value={drafts} label="Drafts" emphasis />
        </Link>
      </CardContent>
    </Card>
  )
}
