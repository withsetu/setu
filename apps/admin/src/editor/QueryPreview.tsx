import { useEffect, useState } from 'react'
import { ImageIcon } from 'lucide-react'
import type { ContentRow, IndexQuery, SortKey } from '@setu/core'

/** The block's attribute bag, as stored on the node (all optional — defaults applied here). */
export interface QueryAttrs {
  collection?: string
  category?: string
  tag?: string
  locale?: string
  limit?: number
  offset?: number
  sort?: 'newest' | 'oldest' | 'title'
  layout?: 'grid' | 'list'
  columns?: number
  showImage?: boolean
}

/** Run the same content-index query the published block resolves, so the editor preview is
 *  real data — not a mock. Injected via editor.storage (like imageBlock.apiBase) so the node
 *  view never reaches into React context. */
export type RunQuery = (q: IndexQuery) => Promise<{ rows: ContentRow[]; total: number }>

const SORT_MAP: Record<NonNullable<QueryAttrs['sort']>, { key: SortKey; dir: 'asc' | 'desc' }> = {
  newest: { key: 'updatedAt', dir: 'desc' },
  oldest: { key: 'updatedAt', dir: 'asc' },
  title: { key: 'title', dir: 'asc' },
}

export function queryFromAttrs(a: QueryAttrs): IndexQuery {
  const q: IndexQuery = {
    collection: a.collection || 'post',
    sort: SORT_MAP[a.sort ?? 'newest'],
    offset: Math.max(0, Number(a.offset) || 0),
    limit: Math.min(50, Math.max(1, Number(a.limit) || 10)),
  }
  if (a.locale) q.locale = a.locale
  if (a.category) q.category = a.category
  if (a.tag) q.tag = a.tag
  return q
}

/** Live, in-canvas preview of what the query block will render: the real matching entries
 *  from the content index, in the chosen layout / column count. */
export function QueryPreview({ attrs, runQuery }: { attrs: QueryAttrs; runQuery: RunQuery | undefined }) {
  const [rows, setRows] = useState<ContentRow[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const collection = attrs.collection || 'post'
  const layout = attrs.layout ?? 'grid'
  const columns = Math.min(6, Math.max(1, Number(attrs.columns) || 3))
  const showImage = attrs.showImage ?? true

  // Re-query whenever any filter/sort/window attribute changes.
  const depKey = JSON.stringify([
    collection, attrs.category, attrs.tag, attrs.locale, attrs.limit, attrs.offset, attrs.sort,
  ])

  useEffect(() => {
    if (!runQuery) return
    let cancelled = false
    setState('loading')
    void runQuery(queryFromAttrs(attrs))
      .then((res) => {
        if (cancelled) return
        setRows(res.rows)
        setTotal(res.total)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runQuery, depKey])

  const label =
    state === 'loading'
      ? 'Loading…'
      : state === 'error'
        ? 'Preview unavailable'
        : `${total} ${collection}${total === 1 ? '' : 's'}${total > rows.length ? ` · showing ${rows.length}` : ''}`

  return (
    <div className="not-prose my-2 rounded-lg border border-border bg-muted/30" contentEditable={false}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Query · {layout === 'grid' ? `grid · ${columns} col${columns === 1 ? '' : 's'}` : 'list'}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{label}</span>
      </div>

      <div className="p-3">
        {state === 'ready' && rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No {collection}s match these filters.</p>
        ) : (
          <ul
            className={
              layout === 'grid'
                ? 'grid list-none gap-3 p-0'
                : 'flex list-none flex-col gap-2 p-0'
            }
            style={layout === 'grid' ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
          >
            {(state === 'loading' ? Array.from({ length: Math.min(columns, 3) }, () => null) : rows).map(
              (row, i) => (
                <li
                  key={row ? `${row.ref.collection}/${row.ref.locale}/${row.ref.slug}` : `sk-${i}`}
                  className={
                    layout === 'list'
                      ? 'flex items-center gap-3 rounded-md border border-border bg-background p-2'
                      : 'overflow-hidden rounded-md border border-border bg-background'
                  }
                >
                  {showImage && (
                    <div
                      className={
                        layout === 'list'
                          ? 'flex aspect-[4/3] w-20 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground'
                          : 'flex aspect-[16/9] w-full items-center justify-center bg-muted text-muted-foreground'
                      }
                    >
                      <ImageIcon className="size-5 opacity-40" />
                    </div>
                  )}
                  <div className={layout === 'list' ? 'min-w-0 flex-1' : 'p-2'}>
                    <p className="truncate text-sm font-medium text-foreground">
                      {row ? row.title : ' '}
                    </p>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
