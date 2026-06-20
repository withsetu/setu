import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { CategoryNode, ContentRow, IndexQuery, LifecycleState, SortKey } from '@setu/core'
import { buildTree } from '@setu/core'
import { useIndex } from '../data/index-store'
import { useTaxonomy } from '../data/taxonomy-store'
import { lifecycleLabel } from '../lifecycle/label'
import { PageHeader } from '../shell/PageHeader'
import { StatusPill } from '../ui/StatusPill'
import { Icon } from '../ui/Icon'
import { siteUrl } from '../shell/site-url'
import { TagFilter } from './TagFilter'

const PAGE_SIZE = 25
const STATUSES: LifecycleState[] = ['draft', 'staged', 'live', 'unpublished']
const STATUS_LABELS: Record<LifecycleState, string> = { draft: 'Draft', staged: 'Staged', live: 'Live', unpublished: 'Unpublished' }
const SORT_KEYS: SortKey[] = ['updatedAt', 'title', 'status']

function flatten(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

const keyOf = (r: ContentRow) => `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`

function parseSort(raw: string | null): { key: SortKey; dir: 'asc' | 'desc' } {
  if (raw) {
    const [key, dir] = raw.split('-')
    if (SORT_KEYS.includes(key as SortKey) && (dir === 'asc' || dir === 'desc')) {
      return { key: key as SortKey, dir }
    }
  }
  return { key: 'updatedAt', dir: 'desc' }
}

export function ContentList({ collection, title }: { collection: string; title: string }) {
  const index = useIndex()
  const { categories } = useTaxonomy()
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ContentRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [locales, setLocales] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)

  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const locale = params.get('locale') ?? ''
  const category = params.get('category') ?? ''
  const tag = params.get('tag') ?? ''
  const sortRaw = params.get('sort')
  const sort = parseSort(sortRaw)
  const hasFilters = Boolean(q || status || locale || category || tag)

  // Category filter options come from the taxonomy (hierarchy + display names).
  const catRows = useMemo(() => flatten(buildTree(categories)), [categories])

  const setParam = (key: string, value: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
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
  }, [collection, q, status, locale, category, tag, sortRaw])

  // Locale dropdown options.
  useEffect(() => {
    let live = true
    void index.distinctLocales().then((ls) => { if (live) setLocales(ls) }).catch(() => {})
    return () => { live = false }
  }, [index])

  // Run the query.
  // NB: intentionally no setRows(null) here — keep prior results visible while a
  // re-filter query resolves (no loading flicker on filter change). Only the
  // initial mount shows "Loading…".
  useEffect(() => {
    let live = true
    void (async () => {
      await index.ensureBuilt()
      const query: IndexQuery = { collection, offset: page * PAGE_SIZE, limit: PAGE_SIZE, sort }
      if (q) query.q = q
      if (status) query.status = status as LifecycleState
      if (locale) query.locale = locale
      if (category) query.category = category
      if (tag) query.tag = tag
      const r = await index.query(query)
      if (live) {
        setRows(r.rows)
        setTotal(r.total)
      }
    })()
    return () => { live = false }
  }, [index, collection, page, q, status, locale, category, tag, sort.key, sort.dir, refreshKey])

  const toggleSort = (key: SortKey) => {
    const dir = sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc'
    setParam('sort', `${key}-${dir}`)
  }
  const sortIndicator = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')

  const clearFilters = () => setParams({}, { replace: true })

  const toggleRow = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const pageKeys = (rows ?? []).map(keyOf)
  const allSelected = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k))
  const toggleAll = () =>
    setSelected((prev) => {
      if (pageKeys.every((k) => prev.has(k))) return new Set()
      return new Set(pageKeys)
    })

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min(total, (page + 1) * PAGE_SIZE)
  const noun = collection

  return (
    <>
      <PageHeader
        title={title}
        count={rows !== null ? total : undefined}
        subtitle={collection === 'post' ? 'Articles, field notes and announcements.' : 'Standalone pages and landing pages.'}
        actions={
          <Link to={`/edit/${collection}/en/new`} className="btn btn-primary btn-md">
            <Icon name="plus" size={16} />
            <span>New {noun}</span>
          </Link>
        }
      />
      <div className="page-body">
        <div className="list-toolbar">
          <input
            type="search"
            className="list-search"
            placeholder={`Search ${title.toLowerCase()}`}
            aria-label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select aria-label="Filter by status" value={status} onChange={(e) => setParam('status', e.target.value)}>
            <option value="">All status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
          <select aria-label="Filter by category" value={category} onChange={(e) => setParam('category', e.target.value)}>
            <option value="">All categories</option>
            {catRows.map((c) => (
              <option key={c.slug} value={c.slug}>{' '.repeat(c.depth * 2)}{c.name}</option>
            ))}
          </select>
          {locales.length > 1 && (
            <select aria-label="Filter by locale" value={locale} onChange={(e) => setParam('locale', e.target.value)}>
              <option value="">All locales</option>
              {locales.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          )}
          <TagFilter value={tag} onChange={(t) => setParam('tag', t)} />
          {hasFilters && (rows === null || rows.length > 0) && (
            // Clear filters also appears in the filtered-empty state below; the toolbar
            // copy is hidden when results are empty so they never both show. Keep both.
            <button type="button" className="btn btn-sm" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
        {rows === null ? (
          <p className="empty-state">Loading…</p>
        ) : rows.length === 0 ? (
          hasFilters ? (
            <p className="empty-state">No {title.toLowerCase()} match these filters. <button type="button" className="btn btn-sm" onClick={clearFilters}>Clear filters</button></p>
          ) : (
            <p className="empty-state">No {title.toLowerCase()} yet.</p>
          )
        ) : (
          <>
            {selected.size > 0 && (
              <div className="bulk-bar">
                <span>{selected.size} selected</span>
                <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
              </div>
            )}
          <div className="list-wrap">
            <table className="ctable">
              <thead>
                <tr>
                  <th className="ctable-check">
                    <input type="checkbox" aria-label="Select all on this page" checked={allSelected} onChange={toggleAll} />
                  </th>
                  <th><button type="button" className="ctable-sort" onClick={() => toggleSort('title')}>Title{sortIndicator('title')}</button></th>
                  <th><button type="button" className="ctable-sort" onClick={() => toggleSort('status')}>Status{sortIndicator('status')}</button></th>
                  <th>Locale</th>
                  <th><button type="button" className="ctable-sort" onClick={() => toggleSort('updatedAt')}>Updated{sortIndicator('updatedAt')}</button></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { label, pending } = lifecycleLabel(row.lifecycle)
                  return (
                    <tr key={`${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`}>
                      <td className="ctable-check">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.title}`}
                          checked={selected.has(keyOf(row))}
                          onChange={() => toggleRow(keyOf(row))}
                        />
                      </td>
                      <td className="ctable-title">
                        <Link to={`/edit/${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`}>{row.title}</Link>
                        {(row.lifecycle.state === 'staged' || row.lifecycle.state === 'live') && (
                          <a className="ctable-view" href={siteUrl(row.ref)} target="_blank" rel="noopener noreferrer" aria-label={`View ${row.title} on site`} title="View on site">
                            <Icon name="external" size={14} />
                          </a>
                        )}
                      </td>
                      <td>
                        <StatusPill status={label} />
                        {pending !== undefined && <span className="status-pending">· {pending}</span>}
                      </td>
                      <td className="ctable-muted">{row.ref.locale}</td>
                      <td className="ctable-muted">{row.updatedAt === null ? '—' : new Date(row.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {total > 0 && (
              <div className="list-pager">
                <span className="ctable-muted">{from}–{to} of {total}</span>
                <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
                <button className="btn btn-sm" disabled={to >= total} onClick={() => setPage((p) => p + 1)} aria-label="Next">Next</button>
              </div>
            )}
          </div>
          </>
        )}
      </div>
    </>
  )
}
