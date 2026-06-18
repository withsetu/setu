import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ContentRow, EntryRef } from '@setu/core'
import { listContentEntries, parseContentPath } from '@setu/core'
import { useServices } from '../data/store'
import { lifecycleLabel } from '../lifecycle/label'
import { useDeploy } from '../deploy/deploy'
import { PageHeader } from '../shell/PageHeader'
import { StatusPill } from '../ui/StatusPill'
import { Icon } from '../ui/Icon'
import { siteUrl } from '../shell/site-url'

export function ContentList({ collection, title }: { collection: string; title: string }) {
  const { data, git } = useServices()
  const { deployedAt, sha: deploySha } = useDeploy()
  const [rows, setRows] = useState<ContentRow[] | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const drafts = await data.listDrafts({ collection })
      const paths = await git.list(`content/${collection}/`)
      const committed: { ref: EntryRef; content: string }[] = []
      for (const p of paths) {
        const ref = parseContentPath(p)
        if (ref === null) continue
        const content = await git.readFile(p)
        if (content !== null) committed.push({ ref, content })
      }
      const merged = listContentEntries({ drafts, committed, deployedAt })
      if (live) setRows(merged)
    })()
    return () => {
      live = false
    }
  }, [data, git, collection, deployedAt, deploySha])

  const noun = collection

  return (
    <>
      <PageHeader
        title={title}
        count={rows?.length}
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
        ) : rows.length === 0 ? (
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
          </div>
        )}
      </div>
    </>
  )
}
