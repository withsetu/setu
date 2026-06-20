import { useMemo, useState } from 'react'
import type { CategoryNode, ContentRow, EntryRef } from '@setu/core'
import { buildTree, bulkAddCategory, bulkRemoveCategory, bulkAddTag, bulkRemoveTag } from '@setu/core'
import { useServices } from '../data/store'
import { useIndex } from '../data/index-store'
import { useTaxonomy } from '../data/taxonomy-store'

function flatten(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

export function BulkBar({
  rows,
  selected,
  onClear,
  onDone,
}: {
  rows: ContentRow[]
  selected: Set<string>
  onClear: () => void
  onDone: () => void
}) {
  const { bulk } = useServices()
  const index = useIndex()
  const { categories } = useTaxonomy()
  const catRows = useMemo(() => flatten(buildTree(categories)), [categories])
  const [cat, setCat] = useState('')
  const [tag, setTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const keyOf = (r: ContentRow) => `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`
  const selectedRows = rows.filter((r) => selected.has(keyOf(r)))
  const refs: EntryRef[] = selectedRows.map((r) => r.ref)
  const pendingCount = selectedRows.filter((r) => r.hasDraft && r.lifecycle.state !== 'live').length

  const run = async (op: () => Promise<{ applied: EntryRef[]; skipped: { ref: EntryRef }[] }>, verb: string) => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await op()
      for (const ref of r.applied) await index.reindexEntry(ref).catch(() => {})
      setMsg(`${verb} ${r.applied.length}${r.skipped.length ? ` · ${r.skipped.length} skipped` : ''}`)
      onDone()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const applyCat = (mut: typeof bulkAddCategory) => {
    if (!cat) return
    void run(() => bulk.applyMetadata(refs, (m) => mut(m, cat)), 'Updated')
  }
  const applyTag = (mut: typeof bulkAddTag) => {
    if (!tag.trim()) return
    void run(() => bulk.applyMetadata(refs, (m) => mut(m, tag)), 'Updated')
  }
  const del = () => {
    if (!window.confirm(`Delete ${refs.length} entr${refs.length === 1 ? 'y' : 'ies'}? This commits their removal.`)) return
    void run(() => bulk.deleteEntries(refs), 'Deleted')
  }

  return (
    <div className="bulk-bar">
      <span className="bulk-count">{selected.size} selected</span>

      <span className="bulk-group">
        <select aria-label="Bulk category" value={cat} onChange={(e) => setCat(e.target.value)} disabled={busy}>
          <option value="">Category…</option>
          {catRows.map((c) => (
            <option key={c.slug} value={c.slug}>{' '.repeat(c.depth * 2)}{c.name}</option>
          ))}
        </select>
        <button type="button" className="btn btn-sm" disabled={busy || !cat} onClick={() => applyCat(bulkAddCategory)}>Add</button>
        <button type="button" className="btn btn-sm" disabled={busy || !cat} onClick={() => applyCat(bulkRemoveCategory)}>Remove</button>
      </span>

      <span className="bulk-group">
        <input type="text" aria-label="Bulk tag" placeholder="Tag…" value={tag} onChange={(e) => setTag(e.target.value)} disabled={busy} />
        <button type="button" className="btn btn-sm" disabled={busy || !tag.trim()} onClick={() => applyTag(bulkAddTag)}>Add tag</button>
        <button type="button" className="btn btn-sm" disabled={busy || !tag.trim()} onClick={() => applyTag(bulkRemoveTag)}>Remove tag</button>
      </span>

      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={del}>Delete</button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={onClear}>Clear selection</button>

      {pendingCount > 0 && (
        <span className="bulk-note">{pendingCount} of {selected.size} have unpublished changes that will also go live.</span>
      )}
      {msg && <span className="bulk-msg" role="status">{msg}</span>}
    </div>
  )
}
