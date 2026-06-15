import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Draft, Lifecycle } from '@saytu/core'
import { useServices } from '../data/store'
import { lifecycleFor } from '../lifecycle/useLifecycle'
import { lifecycleLabel } from '../lifecycle/label'
import { useDeploy } from '../deploy/deploy'
import { PageHeader } from '../shell/PageHeader'
import { StatusPill } from '../ui/StatusPill'
import { Icon } from '../ui/Icon'

export function ContentList({ collection, title }: { collection: string; title: string }) {
  const { data, git } = useServices()
  const { deployedAt, sha: deploySha } = useDeploy()
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [statuses, setStatuses] = useState<Record<string, Lifecycle>>({})

  useEffect(() => {
    let live = true
    void data.listDrafts({ collection }).then(async (d) => {
      if (!live) return
      setDrafts(d)
      const pairs = await Promise.all(
        d.map(async (dr) => {
          const lc = await lifecycleFor(
            { collection: dr.collection, locale: dr.locale, slug: dr.slug },
            dr,
            git,
            deployedAt,
          )
          return [dr.slug, lc] as const
        }),
      )
      if (live) setStatuses(Object.fromEntries(pairs))
    })
    return () => {
      live = false
    }
  }, [data, git, collection, deployedAt, deploySha])

  const noun = collection

  return (
    <>
      <PageHeader
        title={title}
        count={drafts?.length}
        subtitle={collection === 'post' ? 'Articles, field notes and announcements.' : 'Standalone pages and landing pages.'}
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
                {drafts.map((d) => {
                  const lc: Lifecycle = statuses[d.slug] ?? { state: 'draft' }
                  const { label, pending } = lifecycleLabel(lc)
                  return (
                    <tr key={`${d.collection}/${d.locale}/${d.slug}`}>
                      <td className="ctable-title">
                        <Link to={`/edit/${d.collection}/${d.locale}/${d.slug}`}>
                          {String(d.metadata['title'] ?? d.slug)}
                        </Link>
                      </td>
                      <td>
                        <StatusPill status={label} />
                        {pending !== undefined && (
                          <span className="status-pending">· {pending}</span>
                        )}
                      </td>
                      <td className="ctable-muted">{d.locale}</td>
                      <td className="ctable-muted">{new Date(d.updatedAt).toLocaleDateString()}</td>
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
