import type { CategoryNode } from '@setu/core'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function flatten(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) { out.push(n); flatten(n.children, out) }
  return out
}

/** slugs of `slug` and all its descendants — invalid reparent targets (cycle). */
export function descendantsOf(rows: CategoryNode[], slug: string): Set<string> {
  const banned = new Set<string>([slug])
  let changed = true
  while (changed) {
    changed = false
    for (const r of rows) if (r.parent && banned.has(r.parent) && !banned.has(r.slug)) { banned.add(r.slug); changed = true }
  }
  return banned
}

export function CategoryTree({ rows, counts, onRename, onReparent, onDelete }: {
  rows: CategoryNode[]
  counts: Record<string, number>
  onRename: (slug: string, name: string) => void
  onReparent: (slug: string, parent: string | null) => void
  onDelete: (node: CategoryNode) => void
}) {
  return (
    <div className="rounded-lg border border-border/60">
      <div className="flex items-center px-4 py-2.5 text-[12.5px] text-muted-foreground border-b border-border/60 bg-muted/40">
        <div className="flex-1">Name</div>
        <div className="w-28">Used by</div>
        <div className="w-52">Move to</div>
        <div className="w-10" />
      </div>
      {rows.map((node) => {
        const used = counts[node.slug] ?? 0
        const banned = descendantsOf(rows, node.slug)
        return (
          <div key={node.slug} className="flex items-center border-b border-border/40 px-4 py-3 last:border-0"
               style={{ paddingLeft: `${16 + node.depth * 20}px` }}>
            <div className="flex flex-1 items-baseline gap-2.5">
              <input
                key={`name:${node.slug}:${node.name}`}
                defaultValue={node.name}
                aria-label={`Name of ${node.slug}`}
                className="bg-transparent text-[15px] font-medium outline-none focus:underline"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== node.name) onRename(node.slug, v) }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              />
              <span className="text-[12.5px] text-muted-foreground">/{node.slug}</span>
            </div>
            <div className="w-28 text-[13px] text-muted-foreground">{used > 0 ? `${used} ${used === 1 ? 'entry' : 'entries'}` : 'unused'}</div>
            <div className="w-52">
              <Select value={node.parent ?? 'none'} onValueChange={(v) => onReparent(node.slug, v === 'none' ? null : v)}>
                <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Top level</SelectItem>
                  {rows.filter((o) => !banned.has(o.slug)).map((o) => <SelectItem key={o.slug} value={o.slug}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-10 text-right">
              <Button variant="ghost" size="icon" aria-label={`Delete ${node.name}`} onClick={() => onDelete(node)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
