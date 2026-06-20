import { CategoryField } from './CategoryField'
import { TagField } from './TagField'

const STATUSES = ['Draft', 'Staged', 'Deployed'] as const

export function MetaPanel({
  metadata,
  locale,
  slug,
  editable,
  onChange,
}: {
  metadata: Record<string, unknown>
  locale: string
  slug: string
  editable: boolean
  onChange: (next: Record<string, unknown>) => void
}) {
  const current = String(metadata['status'] ?? 'draft').toLowerCase()
  return (
    <aside className="meta-panel">
      <section className="meta-section">
        <h2 className="meta-title">Status</h2>
        <div className="segmented" role="group" aria-label="Status">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={`segmented-opt${current === s.toLowerCase() ? ' on' : ''}`}
              aria-pressed={current === s.toLowerCase()}
              disabled={!editable}
              onClick={() => onChange({ ...metadata, status: s.toLowerCase() })}
            >
              {s}
            </button>
          ))}
        </div>
      </section>
      <section className="meta-section">
        <h2 className="meta-title">Categories</h2>
        <CategoryField
          selected={Array.isArray(metadata['categories']) ? (metadata['categories'] as string[]) : []}
          onChange={(next) => onChange({ ...metadata, categories: next })}
          editable={editable}
        />
      </section>
      <section className="meta-section">
        <h2 className="meta-title">Tags</h2>
        <TagField
          selected={Array.isArray(metadata['tags']) ? (metadata['tags'] as string[]) : []}
          onChange={(next) => onChange({ ...metadata, tags: next })}
          editable={editable}
        />
      </section>
      <section className="meta-section">
        <h2 className="meta-title">Permalink</h2>
        <div className="meta-row"><span className="meta-label">Slug</span><span className="meta-value">/{slug}</span></div>
        <div className="meta-row"><span className="meta-label">Locale</span><span className="meta-value">{locale}</span></div>
      </section>
    </aside>
  )
}
