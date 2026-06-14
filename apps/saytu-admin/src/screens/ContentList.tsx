import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Draft } from '@saytu/core'
import { useData } from '../data/store'

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

  if (drafts === null) return <section className="content-list">Loading…</section>

  return (
    <section className="content-list">
      <h1>{title}</h1>
      {drafts.length === 0 ? (
        <p className="empty-state">No {title.toLowerCase()} yet.</p>
      ) : (
        <table className="content-table">
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
                <td>
                  <Link to={`/edit/${d.collection}/${d.locale}/${d.slug}`}>
                    {String(d.metadata.title ?? d.slug)}
                  </Link>
                </td>
                <td>{String(d.metadata.status ?? 'draft')}</td>
                <td>{d.locale}</td>
                <td>{new Date(d.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
