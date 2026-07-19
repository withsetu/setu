import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ExternalLink,
  FileSearch,
  Image
} from 'lucide-react'
import type { ContentRow, SortKey } from '@setu/core'
import { resolvePermalinkConfig } from '@setu/core'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { statusBadge } from '@/lib/status-badge'
import { relativeTime } from '@/lib/format'
import { siteUrl } from '../../shell/site-url'
import { useSettings } from '../../data/settings-store'
import { Chips } from './Chips'
import type { ColumnKey } from './useColumnPrefs'

const keyOf = (r: ContentRow) =>
  `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`

function SortHead({
  label,
  k,
  sort,
  onSort
}: {
  label: string
  k: SortKey
  sort: { key: SortKey; dir: 'asc' | 'desc' }
  onSort: (k: SortKey) => void
}) {
  const active = sort.key === k
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
    >
      {label}
      {active &&
        (sort.dir === 'asc' ? (
          <ArrowUp className="size-3.5" />
        ) : (
          <ArrowDown className="size-3.5" />
        ))}
    </button>
  )
}

/** Boolean indicator cell content (#576/#577): a subtle tick or muted dash, never a
 *  value. `title` + aria-label carry the meaning for hover and screen readers. */
function IndicatorMark({ on, onLabel, offLabel }: IndicatorMarkProps) {
  return (
    <span
      role="img"
      aria-label={on ? onLabel : offLabel}
      title={on ? onLabel : offLabel}
      className={
        on
          ? 'inline-flex items-center justify-center'
          : 'text-muted-foreground/50'
      }
    >
      {on ? <Check aria-hidden="true" className="size-4 text-success" /> : '—'}
    </span>
  )
}
interface IndicatorMarkProps {
  on: boolean
  onLabel: string
  offLabel: string
}

export function ContentTable({
  rows,
  gen,
  visible,
  showLocale,
  categoryName,
  selected,
  allSelected,
  onToggleRow,
  onToggleAll,
  sort,
  onSort,
  selectable = true,
  showCollection = false
}: {
  rows: ContentRow[]
  gen: number
  visible: Record<ColumnKey, boolean>
  showLocale: boolean
  categoryName: (slug: string) => string
  selected: Set<string>
  allSelected: boolean
  onToggleRow: (k: string) => void
  onToggleAll: () => void
  sort: { key: SortKey; dir: 'asc' | 'desc' }
  onSort: (k: SortKey) => void
  // #362: an actor without content.edit gets no selection column, so it has no path to the bulk
  // actions. Every current staff role holds content.edit, so this is defensive (future
  // audience/read-only roles land in #379). Defaults true; ContentList passes the actor's
  // content.edit capability.
  selectable?: boolean
  /** Show which collection each row belongs to. On in the cross-collection view
   *  (/content) only — on /posts or /pages every row has the same answer, so the
   *  column would be pure noise. Not in the columns menu for that reason: where
   *  it appears it is required context, not a preference (#604). */
  showCollection?: boolean
}) {
  const reduce = useReducedMotion()
  const localeCol = visible.locale && showLocale
  const settings = useSettings()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selectable && (
            <TableHead className="w-10 pl-6">
              <Checkbox
                aria-label="Select all on this page"
                checked={allSelected}
                onCheckedChange={onToggleAll}
              />
            </TableHead>
          )}
          {/* w-full: the Title column absorbs whatever width the fixed-width trailing columns
              leave over — see the matching w-full max-w-0 on the title cells below (#554).
              min-w-48: content-sized columns (long tag/category chips) must never squeeze the
              primary column below readability — past that the wrapper scrolls, the title holds. */}
          <TableHead className="w-full min-w-48">
            <SortHead label="Title" k="title" sort={sort} onSort={onSort} />
          </TableHead>
          {showCollection && <TableHead className="w-24">Type</TableHead>}
          {visible.status && (
            <TableHead className="w-32">
              <SortHead label="Status" k="status" sort={sort} onSort={onSort} />
            </TableHead>
          )}
          {visible.tags && <TableHead className="w-44">Tags</TableHead>}
          {visible.categories && (
            <TableHead className="w-36">Categories</TableHead>
          )}
          {visible.featured && (
            <TableHead className="w-16 text-center">
              <span
                className="inline-flex items-center justify-center"
                title="Featured image"
              >
                <Image aria-hidden="true" className="size-4" />
                <span className="sr-only">Featured image</span>
              </span>
            </TableHead>
          )}
          {visible.seo && (
            <TableHead className="w-16 text-center">
              <span
                className="inline-flex items-center justify-center"
                title="Custom SEO"
              >
                <FileSearch aria-hidden="true" className="size-4" />
                <span className="sr-only">Custom SEO</span>
              </span>
            </TableHead>
          )}
          {localeCol && (
            <TableHead className="w-24">
              <SortHead label="Locale" k="locale" sort={sort} onSort={onSort} />
            </TableHead>
          )}
          {visible.updated && (
            <TableHead className="w-36 pr-6 text-right">
              <SortHead
                label="Updated"
                k="updatedAt"
                sort={sort}
                onSort={onSort}
              />
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => {
          const k = keyOf(r)
          const s = statusBadge(r.lifecycle)
          const published =
            r.lifecycle.state === 'staged' || r.lifecycle.state === 'live'
          return (
            <motion.tr
              key={`${gen}:${k}`}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.18,
                delay: reduce ? 0 : Math.min(i, 12) * 0.04
              }}
              className={`border-b border-border/40 transition-colors ${i % 2 === 1 ? 'bg-muted/25' : ''} hover:bg-muted/50 data-[state=selected]:bg-primary/10`}
              data-state={selected.has(k) ? 'selected' : undefined}
            >
              {selectable && (
                <TableCell className="pl-6">
                  <Checkbox
                    aria-label={`Select ${r.title}`}
                    checked={selected.has(k)}
                    onCheckedChange={() => onToggleRow(k)}
                  />
                </TableCell>
              )}
              {/* #554: w-full + max-w-0 bound the cell to the column's share of the table width —
                  without the max-width an auto-layout cell grows to fit its content and the inner
                  `truncate` never engages, so a long title stretched the table past the viewport.
                  min-w-48 (with the header) keeps that share readable when chip columns are wide. */}
              <TableCell className="w-full min-w-48 max-w-0">
                <div className="flex items-center gap-1.5">
                  <Link
                    to={`/edit/${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`}
                    title={r.title}
                    className="min-w-0 truncate text-[15px] font-medium text-foreground hover:underline"
                  >
                    {r.title}
                  </Link>
                  {published && (
                    <a
                      href={siteUrl(
                        { ...r.ref, date: r.date, categories: r.categories },
                        resolvePermalinkConfig(
                          r.ref.collection,
                          undefined,
                          settings
                        ),
                        settings.reading.homepage || undefined
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View ${r.title} on site`}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
                <div
                  title={`/${r.ref.slug}`}
                  className="mt-0.5 truncate text-[12.5px] text-muted-foreground"
                >
                  /{r.ref.slug}
                </div>
              </TableCell>
              {showCollection && (
                <TableCell className="capitalize text-muted-foreground">
                  {r.ref.collection}
                </TableCell>
              )}
              {visible.status && (
                <TableCell>
                  <span className="inline-flex items-center gap-1.5">
                    <Badge variant={s.variant}>{s.label}</Badge>
                    {r.lifecycle.pending && (
                      <span className="text-xs text-muted-foreground">
                        · {r.lifecycle.pending}
                      </span>
                    )}
                  </span>
                </TableCell>
              )}
              {visible.tags && (
                <TableCell>
                  <Chips items={r.tags} />
                </TableCell>
              )}
              {visible.categories && (
                <TableCell>
                  <Chips items={r.categories} name={categoryName} />
                </TableCell>
              )}
              {visible.featured && (
                <TableCell className="text-center">
                  <IndicatorMark
                    on={r.hasFeaturedImage}
                    onLabel="Has featured image"
                    offLabel="No featured image"
                  />
                </TableCell>
              )}
              {visible.seo && (
                <TableCell className="text-center">
                  <IndicatorMark
                    on={r.hasSeoOverrides}
                    onLabel="Custom SEO set"
                    offLabel="No custom SEO"
                  />
                </TableCell>
              )}
              {localeCol && (
                <TableCell className="text-muted-foreground">
                  {r.ref.locale}
                </TableCell>
              )}
              {visible.updated && (
                <TableCell className="pr-6 text-right text-muted-foreground">
                  {relativeTime(r.updatedAt)}
                </TableCell>
              )}
            </motion.tr>
          )
        })}
      </TableBody>
    </Table>
  )
}
