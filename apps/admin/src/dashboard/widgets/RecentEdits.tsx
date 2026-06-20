import { Link } from 'react-router-dom'
import type { ContentRow } from '@setu/core'
import { lifecycleLabel } from '../../lifecycle/label'
import { StatusPill } from '../../ui/StatusPill'

export function RecentEdits({ rows }: { rows: ContentRow[] }) {
  return (
    <section className="dash-card">
      <h2 className="dash-card-title">Recently edited</h2>
      {rows.length === 0 ? (
        <p className="empty-state">Nothing edited yet.</p>
      ) : (
        <ul className="dash-recent">
          {rows.map((row) => (
            <li key={`${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`} className="dash-recent-row">
              <Link to={`/edit/${row.ref.collection}/${row.ref.locale}/${row.ref.slug}`}>{row.title}</Link>
              <StatusPill status={lifecycleLabel(row.lifecycle).label} />
              <span className="ctable-muted">
                {row.updatedAt === null ? '—' : new Date(row.updatedAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
