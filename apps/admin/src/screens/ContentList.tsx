import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { CategoryNode, ContentRow, IndexQuery, SortKey } from '@setu/core'
import { buildTree, isIndexStatusFilter } from '@setu/core'
import { useIndex } from '../data/index-store'
import { useTaxonomy } from '../data/taxonomy-store'
import { useCan } from '../auth/actor'
import { PageHeader } from '../shell/PageHeader'
import { PageBody } from '../shell/PageBody'
import { Button } from '@/components/ui/button'
import { BulkBar } from './BulkBar'
import { ListToolbar } from './content-list/ListToolbar'
import { ColumnsMenu } from './content-list/ColumnsMenu'
import { ContentTable } from './content-list/ContentTable'
import { Pager } from './content-list/Pager'
import { useColumnPrefs } from './content-list/useColumnPrefs'
import { useSettings } from '../data/settings-store'

const SORT_KEYS: SortKey[] = ['updatedAt', 'title', 'status', 'locale']

function flatten(
  nodes: CategoryNode[],
  out: CategoryNode[] = []
): CategoryNode[] {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

const keyOf = (r: ContentRow) =>
  `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`

function parseSort(raw: string | null): { key: SortKey; dir: 'asc' | 'desc' } {
  if (raw) {
    const [key, dir] = raw.split('-')
    if (
      SORT_KEYS.includes(key as SortKey) &&
      (dir === 'asc' || dir === 'desc')
    ) {
      return { key: key as SortKey, dir }
    }
  }
  return { key: 'updatedAt', dir: 'desc' }
}

/** The content list. `collection` scopes it to one collection (/posts, /pages);
 *  OMIT it for the cross-collection view at /content, which lists every
 *  collection together (#604).
 *
 *  That view exists because the dashboard's Live/Staged/Drafts tiles count post +
 *  page: linking them at /posts made the tile's number and the list's number
 *  disagree (Staged said 19, the list showed 5). The scope of the destination was
 *  widened to match what was counted; the alternative — counting only posts —
 *  would have dropped page-level publish status off the dashboard entirely. */
export function ContentList({
  collection,
  title
}: {
  collection?: string
  title: string
}) {
  const index = useIndex()
  const { categories } = useTaxonomy()
  const can = useCan()
  // #362: an actor without content.edit gets no selection column or bulk bar, and no "New"
  // affordance without content.create. Every current staff role holds these, so the gate is
  // defensive (future audience/read-only roles land in #379). The server re-enforces both
  // (git-write is content.edit).
  const canEdit = can('content.edit')
  const pageSize = useSettings().reading.listPageSize
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ContentRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [locales, setLocales] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)

  const q = params.get('q') ?? ''
  // Validated against the index's own filter vocabulary (draft|staged|live|
  // unpublished|published, #579): junk in the URL falls back to "all status"
  // rather than silently producing an empty list the toolbar can't explain.
  const statusRaw = params.get('status') ?? ''
  const status = isIndexStatusFilter(statusRaw) ? statusRaw : ''
  const locale = params.get('locale') ?? ''
  const category = params.get('category') ?? ''
  const tag = params.get('tag') ?? ''
  // 'has' | 'none' | '' — anything else in the URL is ignored (#576).
  const featuredRaw = params.get('featured') ?? ''
  const featured =
    featuredRaw === 'has' || featuredRaw === 'none' ? featuredRaw : ''
  // 'custom' | 'none' | '' — anything else in the URL is ignored (#577).
  const seoRaw = params.get('seo') ?? ''
  const seo = seoRaw === 'custom' || seoRaw === 'none' ? seoRaw : ''
  const sortRaw = params.get('sort')
  const sort = parseSort(sortRaw)
  const hasFilters = Boolean(
    q || status || locale || category || tag || featured || seo
  )

  // Category filter options come from the taxonomy (hierarchy + display names).
  const catRows = useMemo(() => flatten(buildTree(categories)), [categories])

  // Category name lookup for the table display.
  const categoryNameMap = useMemo(
    () => new Map(catRows.map((c) => [c.slug, c.name])),
    [catRows]
  )
  const categoryName = (slug: string) => categoryNameMap.get(slug) ?? slug

  // Column visibility preferences.
  const multilingual = locales.length > 1
  const { visible, toggle } = useColumnPrefs(multilingual)

  // Animation generation counter — increments on mount + page change only (NOT on filter/sort).
  const [gen, setGen] = useState(0)
  useEffect(() => {
    setGen((g) => g + 1)
  }, [page])

  const setParam = (key: string, value: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true }
    )
  }

  // Debounced search: local input → URL `q`.
  const [search, setSearch] = useState(q)
  useEffect(() => {
    setSearch(q)
  }, [q])
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== q) setParam('q', search)
    }, 200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Reset to page 0 when collection or any filter/sort changes.
  useEffect(() => {
    setPage(0)
    setSelected(new Set())
  }, [collection, q, status, locale, category, tag, featured, seo, sortRaw])

  // Reset to page 0 when the page size changes.
  useEffect(() => {
    setPage(0)
  }, [pageSize])

  // Clear selection when navigating between pages (selection is current-page-scoped).
  useEffect(() => {
    setSelected(new Set())
  }, [page])

  // Locale dropdown options.
  useEffect(() => {
    let live = true
    void index
      .distinctLocales()
      .then((ls) => {
        if (live) setLocales(ls)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [index])

  // Run the query.
  // NB: intentionally no setRows(null) here — keep prior results visible while a
  // re-filter query resolves (no loading flicker on filter change). Only the
  // initial mount shows "Loading…".
  useEffect(() => {
    let live = true
    void (async () => {
      await index.ensureBuilt()
      const query: IndexQuery = {
        // Absent collection = every collection (#604).
        ...(collection !== undefined ? { collection } : {}),
        offset: page * pageSize,
        limit: pageSize,
        sort
      }
      if (q) query.q = q
      if (status) query.status = status
      if (locale) query.locale = locale
      if (category) query.category = category
      if (tag) query.tag = tag
      if (featured) query.hasFeaturedImage = featured === 'has'
      if (seo) query.hasSeoOverrides = seo === 'custom'
      const r = await index.query(query)
      if (live) {
        setRows(r.rows)
        setTotal(r.total)
      }
    })()
    return () => {
      live = false
    }
  }, [
    index,
    collection,
    page,
    pageSize,
    q,
    status,
    locale,
    category,
    tag,
    featured,
    seo,
    sort.key,
    sort.dir,
    refreshKey
  ])

  const toggleSort = (key: SortKey) => {
    const dir = sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc'
    setParam('sort', `${key}-${dir}`)
  }

  const clearFilters = () => setParams({}, { replace: true })

  const toggleRow = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const pageKeys = (rows ?? []).map(keyOf)
  const allSelected =
    pageKeys.length > 0 && pageKeys.every((k) => selected.has(k))
  const toggleAll = () =>
    setSelected((prev) => {
      if (pageKeys.every((k) => prev.has(k))) return new Set()
      return new Set(pageKeys)
    })

  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  const noun = collection ?? 'entry'
  // "No all content match these filters" reads badly — the cross-collection view
  // needs a real noun of its own.
  const plural = collection !== undefined ? title.toLowerCase() : 'entries'

  return (
    <>
      <PageHeader
        title={title}
        count={rows !== null ? total : undefined}
        subtitle={
          collection === 'post'
            ? 'Articles, field notes and announcements.'
            : collection === 'page'
              ? 'Standalone pages and landing pages.'
              : 'Every post and page together, in one list.'
        }
        actions={
          // No "New" affordance in the cross-collection view: there is no one
          // collection to create into, and guessing one would be worse than
          // sending the user to Posts or Pages, where the button is unambiguous.
          collection !== undefined && can('content.create') ? (
            <Button asChild>
              <Link to={`/edit/${collection}/en/new`}>
                <Plus className="size-4" />
                New {noun}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        <ListToolbar
          title={title}
          search={search}
          onSearch={setSearch}
          status={status}
          onStatus={(v) => setParam('status', v)}
          category={category}
          onCategory={(v) => setParam('category', v)}
          catRows={catRows}
          tag={tag}
          onTag={(t) => setParam('tag', t)}
          featured={featured}
          onFeatured={(v) => setParam('featured', v)}
          seo={seo}
          onSeo={(v) => setParam('seo', v)}
          hasFilters={hasFilters && (rows === null || rows.length > 0)}
          onClear={clearFilters}
          columnsMenu={
            <ColumnsMenu
              visible={visible}
              toggle={toggle}
              showLocale={multilingual}
            />
          }
        />
        {rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          hasFilters ? (
            <p className="text-sm text-muted-foreground">
              No {plural} match these filters.{' '}
              <Button variant="link" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No {plural} yet.</p>
          )
        ) : (
          <>
            {canEdit && selected.size > 0 && (
              <BulkBar
                rows={rows}
                selected={selected}
                onClear={() => setSelected(new Set())}
                onDone={() => {
                  setSelected(new Set())
                  setRefreshKey((k) => k + 1)
                }}
              />
            )}
            <div className="overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)]">
              <ContentTable
                rows={rows}
                gen={gen}
                // Post or page? Only ambiguous — and only worth a column — when
                // the list spans collections.
                showCollection={collection === undefined}
                visible={visible}
                showLocale={multilingual}
                categoryName={categoryName}
                selected={selected}
                allSelected={allSelected}
                onToggleRow={toggleRow}
                onToggleAll={toggleAll}
                sort={sort}
                onSort={toggleSort}
                selectable={canEdit}
              />
              {total > 0 && (
                <Pager
                  from={from}
                  to={to}
                  total={total}
                  page={page}
                  onPage={setPage}
                />
              )}
            </div>
          </>
        )}
      </PageBody>
    </>
  )
}
