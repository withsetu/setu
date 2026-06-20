import type { Lock } from '@setu/core'

export function WhosEditing({ locks }: { locks: Lock[] }) {
  return (
    <section className="dash-card">
      <h2 className="dash-card-title">Currently editing</h2>
      {locks.length === 0 ? (
        <p className="empty-state">No one is editing right now.</p>
      ) : (
        <ul className="dash-locks">
          {locks.map((l) => (
            <li key={`${l.collection}/${l.locale}/${l.slug}`} className="dash-lock-row">
              <span className="dash-lock-slug">{l.slug}</span>
              <span className="ctable-muted">🔒 {l.lockedBy}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
