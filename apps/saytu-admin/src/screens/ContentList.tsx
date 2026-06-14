import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Draft } from '@saytu/core'
import { useData } from '../data/store'
import { PageHeader } from '../shell/PageHeader'
import { StatusPill } from '../ui/StatusPill'
import { Icon } from '../ui/Icon'

export function ContentList({ collection, title }: { collection: string; title: string }) {
  const data = useData()
  const [drafts, setDrafts] = useState<Draft[] | null>(null)

  useEffect(() => {
    let live = true
    void data.listDrafts({ collection }).then((d) => {
      if (live) setDrafts(d)
    })
    return () => {
      live = false
    }
  }, [data, collection])

  const noun = title.toLowerCase().replace(/s$/, '')

  return (
    <>
      <PageHeader
        title={title}
        count={drafts?.length}
        subtitle={collection === 'post' ? 'Articles, notes and announcements.' : 'Standalone pages.'}
        actions={
          <Link to={`/edit/${collection}/en/new`} className="btn btn-primary btn-md">
            <Icon name="plus" size={16} />
            <span>New {noun}</span>
          </Link>
        }
      />
      <div className="page-body">
        {drafts === null ? (
          <p className="empty-state">Loading…</p>
        ) : drafts.length === 0 ? (
          <p className="empty-state">No {title.toLowerCase()} yet.</p>
        ) : (
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
              {drafts.map((d) => (
                <tr key={`${d.collection}/${d.locale}/${d.slug}`}>
                  <td className="ctable-title">
                    <Link to={`/edit/${d.collection}/${d.locale}/${d.slug}`}>
                      {String(d.metadata['title'] ?? d.slug)}
                    </Link>
                  </td>
                  <td>
                    <StatusPill status={String(d.metadata['status'] ?? 'draft')} />
                  </td>
                  <td className="ctable-muted">{d.locale}</td>
                  <td className="ctable-muted">{new Date(d.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
