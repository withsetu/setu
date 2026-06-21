import { useMemo, useState } from 'react'
import type { ContentRow, EntryRef } from '@setu/core'
import { buildTree, bulkAddCategory, bulkRemoveCategory, bulkAddTag, bulkRemoveTag } from '@setu/core'
import { useServices } from '../data/store'
import { useIndex } from '../data/index-store'
import { useTaxonomy } from '../data/taxonomy-store'
import { useNotify } from '../ui/notify'
import { TagAutocomplete } from '../ui/TagAutocomplete'
import { CategoryPicker } from '../ui/CategoryPicker'

function flattenCats(nodes: ReturnType<typeof buildTree>, out: { slug: string; name: string }[] = []) {
  for (const n of nodes) {
    out.push({ slug: n.slug, name: n.name })
    flattenCats(n.children, out)
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
  const notify = useNotify()
  const { categories } = useTaxonomy()
  const nameBySlug = useMemo(
    () => new Map(flattenCats(buildTree(categories)).map((c) => [c.slug, c.name])),
    [categories],
  )
  const [catVal, setCatVal] = useState('')
  const [cat, setCat] = useState('')
  const [tagVal, setTagVal] = useState('')
  const [busy, setBusy] = useState(false)

  const keyOf = (r: ContentRow) => `${r.ref.collection}/${r.ref.locale}/${r.ref.slug}`
  const selectedRows = rows.filter((r) => selected.has(keyOf(r)))
  const refs: EntryRef[] = selectedRows.map((r) => r.ref)
  const pendingCount = selectedRows.filter((r) => r.hasDraft && r.lifecycle.state !== 'live').length

  const run = async (op: () => Promise<{ applied: EntryRef[]; skipped: { ref: EntryRef }[] }>, label: string) => {
    setBusy(true)
    try {
      const r = await op()
      for (const ref of r.applied) await index.reindexEntry(ref).catch(() => {})
      const skipped = r.skipped.length ? ` · ${r.skipped.length} skipped` : ''
      notify.success(`${label} ${r.applied.length} post${r.applied.length === 1 ? '' : 's'}${skipped}`)
      onDone()
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const applyCat = (mut: typeof bulkAddCategory, verb: string) => {
    if (!cat) return
    void run(() => bulk.applyMetadata(refs, (m) => mut(m, cat)), verb).then(() => {
      setCat('')
      setCatVal('')
    })
  }
  const applyTag = (rawTag: string, mut: typeof bulkAddTag, verb: string) => {
    const t = rawTag.trim()
    if (!t) return
    void run(() => bulk.applyMetadata(refs, (m) => mut(m, t)), verb).then(() => setTagVal(''))
  }
  const del = () => {
    if (!window.confirm(`Delete ${refs.length} post${refs.length === 1 ? '' : 's'}? This commits their removal.`)) return
    void run(() => bulk.deleteEntries(refs), 'Deleted')
  }

  return (
    <div className="bulk-bar">
      <span className="bulk-count">{selected.size} selected</span>

      <span className="bulk-group">
        <CategoryPicker
          value={catVal}
          onChange={(text) => { setCatVal(text); setCat('') }}
          onSubmit={(slug) => { setCat(slug); setCatVal(nameBySlug.get(slug) ?? slug) }}
          ariaLabel="Bulk category"
          disabled={busy}
        />
        <button type="button" className="btn btn-sm" disabled={busy || !cat} onClick={() => applyCat(bulkAddCategory, 'Added category to')}>Add</button>
        <button type="button" className="btn btn-sm" disabled={busy || !cat} onClick={() => applyCat(bulkRemoveCategory, 'Removed category from')}>Remove</button>
      </span>

      <span className="bulk-group">
        <TagAutocomplete
          value={tagVal}
          onChange={setTagVal}
          onSubmit={(tag) => applyTag(tag, bulkAddTag, `Added "${tag}" to`)}
          placeholder="Tag…"
          ariaLabel="Bulk tag"
          disabled={busy}
        />
        <button type="button" className="btn btn-sm" disabled={busy || !tagVal.trim()} onClick={() => applyTag(tagVal, bulkRemoveTag, 'Removed tag from')}>Remove</button>
      </span>

      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={del}>Delete</button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={onClear}>Clear selection</button>

      {pendingCount > 0 && (
        <span className="bulk-note">{pendingCount} of {selectedRows.length} have unpublished changes that will also go live.</span>
      )}
    </div>
  )
}
