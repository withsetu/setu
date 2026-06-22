import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowDown, ArrowUp, ExternalLink } from 'lucide-react'
import type { ContentRow, SortKey } from '@setu/core'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { statusBadge } from '@/lib/status-badge'
import { relativeTime } from '@/lib/format'
import { siteUrl } from '../../shell/site-url'
import { Chips } from './Chips'
import type { ColumnKey } from './useColumnPrefs'

const keyOf = (r: ContentRow) => `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`

function SortHead({ label, k, sort, onSort }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void
}) {
  const active = sort.key === k
  return (
    <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
      {label}
      {active && (sort.dir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
    </button>
  )
}

export function ContentTable({
  rows, gen, visible, showLocale, categoryName,
  selected, allSelected, onToggleRow, onToggleAll, sort, onSort,
}: {
  rows: ContentRow[]; gen: number
  visible: Record<ColumnKey, boolean>; showLocale: boolean; categoryName: (slug: string) => string
  selected: Set<string>; allSelected: boolean
  onToggleRow: (k: string) => void; onToggleAll: () => void
  sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void
}) {
  const reduce = useReducedMotion()
  const localeCol = visible.locale && showLocale
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 pl-4"><Checkbox aria-label="Select all on this page" checked={allSelected} onCheckedChange={onToggleAll} /></TableHead>
          <TableHead><SortHead label="Title" k="title" sort={sort} onSort={onSort} /></TableHead>
          {visible.status && <TableHead className="w-24"><SortHead label="Status" k="status" sort={sort} onSort={onSort} /></TableHead>}
          {visible.tags && <TableHead className="w-40">Tags</TableHead>}
          {visible.categories && <TableHead className="w-32">Categories</TableHead>}
          {localeCol && <TableHead className="w-20">Locale</TableHead>}
          {visible.updated && <TableHead className="w-28 pr-4"><SortHead label="Updated" k="updatedAt" sort={sort} onSort={onSort} /></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          const k = keyOf(r); const s = statusBadge(r.lifecycle)
          const published = r.lifecycle.state === 'staged' || r.lifecycle.state === 'live'
          return (
            <motion.tr
              key={`${gen}:${k}`}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: reduce ? 0 : Math.min(i, 12) * 0.025 }}
              className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
              data-state={selected.has(k) ? 'selected' : undefined}
            >
              <TableCell className="pl-4"><Checkbox aria-label={`Select ${r.title}`} checked={selected.has(k)} onCheckedChange={() => onToggleRow(k)} /></TableCell>
              <TableCell className="font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Link to={`/edit/${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`} className="truncate hover:underline">{r.title}</Link>
                  {published && (
                    <a href={siteUrl(r.ref)} target="_blank" rel="noopener noreferrer" aria-label={`View ${r.title} on site`} className="text-muted-foreground hover:text-foreground"><ExternalLink className="size-3.5" /></a>
                  )}
                </span>
              </TableCell>
              {visible.status && (
                <TableCell>
                  <span className="inline-flex items-center gap-1.5">
                    <Badge variant={s.variant}>{s.label}</Badge>
                    {r.lifecycle.pending && <span className="text-xs text-muted-foreground">· {r.lifecycle.pending}</span>}
                  </span>
                </TableCell>
              )}
              {visible.tags && <TableCell><Chips items={r.tags} /></TableCell>}
              {visible.categories && <TableCell><Chips items={r.categories} name={categoryName} /></TableCell>}
              {localeCol && <TableCell className="text-muted-foreground">{r.ref.locale}</TableCell>}
              {visible.updated && <TableCell className="pr-4 text-muted-foreground">{relativeTime(r.updatedAt)}</TableCell>}
            </motion.tr>
          )
        })}
      </TableBody>
    </Table>
  )
}
