import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import type { ContentRow } from '@setu/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { statusBadge } from '@/lib/status-badge'
import { relativeTime } from '@/lib/format'

export function ResumeEditing({ rows }: { rows: ContentRow[] }) {
  const reduce = useReducedMotion()
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Resume editing</CardTitle>
        <Link to="/posts" className="text-sm text-primary hover:underline">View all</Link>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No edits yet — <Link to="/edit/post/en/new" className="text-primary hover:underline">create your first post</Link>.
          </p>
        ) : (
          <ul>
            {rows.map((r, i) => {
              const s = statusBadge(r.lifecycle)
              return (
                <motion.li
                  key={`${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: reduce ? 0 : i * 0.04 }}
                  className="flex items-center justify-between gap-3 border-t border-border py-2.5 first:border-t-0"
                >
                  <Link to={`/edit/${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`} className="group min-w-0">
                    <span className="block truncate text-sm font-medium group-hover:underline">{r.title}</span>
                    <span className="text-xs text-muted-foreground">
                      <span className="mr-2 rounded border border-border px-1.5 py-0.5">{r.ref.collection}</span>
                      edited {relativeTime(r.updatedAt)}
                    </span>
                  </Link>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </motion.li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
