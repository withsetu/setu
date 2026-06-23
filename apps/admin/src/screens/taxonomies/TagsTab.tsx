import { useMemo, useState } from 'react'
import { normalizeTag } from '@setu/core'
import { useTags } from '../../data/tags-store'
import { useNotify } from '../../ui/notify'
import { TagToolbar, type TagSort } from './TagToolbar'
import { TagList, type TagRow } from './TagList'
import { DeleteTagDialog } from './DeleteTagDialog'
import { MergeTagDialog, type PendingMerge } from './MergeTagDialog'

export function TagsTab() {
  const { counts, rename } = useTags()
  const notify = useNotify()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<TagSort>('count')
  const [pendingDelete, setPendingDelete] = useState<TagRow | null>(null)
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null)

  const rows = useMemo<TagRow[]>(() => {
    const all = Object.entries(counts).map(([tag, count]) => ({ tag, count }))
    const filtered = q.trim() ? all.filter((r) => r.tag.includes(q.trim().toLowerCase())) : all
    filtered.sort((a, b) => sort === 'alpha' ? a.tag.localeCompare(b.tag) : (b.count - a.count || a.tag.localeCompare(b.tag)))
    return filtered
  }, [counts, q, sort])

  const onRename = async (from: string, to: string) => {
    const target = normalizeTag(to)
    if (!target || target === from) return
    if (counts[target] !== undefined) {
      setPendingMerge({ from, to: target, fromCount: counts[from] ?? 0, toCount: counts[target] })
      return
    }
    try {
      const { applied } = await rename(from, target)
      notify.success(`Renamed "${from}" → "${target}" across ${applied} ${applied === 1 ? 'entry' : 'entries'}`)
    } catch (e) { notify.error(e instanceof Error ? e.message : String(e)) }
  }

  if (Object.keys(counts).length === 0) {
    return <p className="text-sm text-muted-foreground">Tags appear here as you add them to content.</p>
  }

  return (
    <div>
      <TagToolbar q={q} onQ={setQ} sort={sort} onSort={setSort} />
      <TagList rows={rows} onRename={onRename} onDelete={setPendingDelete} />
      <div className="mt-3.5 flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3.5 py-3 text-[13px] text-muted-foreground">
        Renaming a tag to a name that already exists merges them — you'll be asked to confirm first.
      </div>
      <DeleteTagDialog row={pendingDelete} onClose={() => setPendingDelete(null)} />
      <MergeTagDialog pending={pendingMerge} onClose={() => setPendingMerge(null)} />
    </div>
  )
}
