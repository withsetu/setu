import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ContentRow } from '@setu/core'
import { useIndex } from '../data/index-store'
import { lifecycleLabel } from '../lifecycle/label'
import { PageHeader } from '../shell/PageHeader'
import { StatusPill } from '../ui/StatusPill'
import { Icon } from '../ui/Icon'
import { siteUrl } from '../shell/site-url'

const PAGE_SIZE = 25

export function ContentList({ collection, title }: { collection: string; title: string }) {
  const index = useIndex()
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ContentRow[] | null>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    setPage(0)
    setRows(null)
    setTotal(0)
  }, [collection])

  useEffect(() => {
    let live = true
    void (async () => {
      await index.ensureBuilt()
      const r = await index.query({
        collection, offset: page * PAGE_SIZE, limit: PAGE_SIZE,
        sort: { key: 'updatedAt', dir: 'desc' },
      })
      if (live) { setRows(r.rows); setTotal(r.total) }
    })()
    return () => { live = false }
  }, [index, collection, page])

  const noun = collection

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min(total, (page + 1) * PAGE_SIZE)

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
        {rows === null ? (
          <p className="empty-state">Loading…</p>
        ) : rows.length === 0 && total === 0 ? (
          <p className="empty-state">No {title.toLowerCase()} yet.</p>
        ) : (
          <div className="list-wrap">
            <table className="ctable">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Locale</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { label, pending } = lifecycleLabel(row.lifecycle)
                  return (
                    <tr key={`${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`}>
                      <td className="ctable-title">
                        <Link to={`/edit/${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`}>
                          {row.title}
                        </Link>
                        {(row.lifecycle.state === 'staged' || row.lifecycle.state === 'live') && (
                          <a
                            className="ctable-view"
                            href={siteUrl(row.ref)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`View ${row.title} on site`}
                            title="View on site"
                          >
                            <Icon name="external" size={14} />
                          </a>
                        )}
                      </td>
                      <td>
                        <StatusPill status={label} />
                        {pending !== undefined && <span className="status-pending">· {pending}</span>}
                      </td>
                      <td className="ctable-muted">{row.ref.locale}</td>
                      <td className="ctable-muted">
                        {row.updatedAt === null ? '—' : new Date(row.updatedAt).toLocaleDateString()}
                      </td>
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
        )}
      </div>
    </>
  )
}
