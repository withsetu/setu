import type { CategoryNode } from '@setu/core'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@/components/ui/select'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell
} from '@/components/ui/table'

export function flatten(
  nodes: CategoryNode[],
  out: CategoryNode[] = []
): CategoryNode[] {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

/** slugs of `slug` and all its descendants — invalid reparent targets (cycle). */
export function descendantsOf(rows: CategoryNode[], slug: string): Set<string> {
  const banned = new Set<string>([slug])
  let changed = true
  while (changed) {
    changed = false
    for (const r of rows)
      if (r.parent && banned.has(r.parent) && !banned.has(r.slug)) {
        banned.add(r.slug)
        changed = true
      }
  }
  return banned
}

/** #385: a real shadcn Table, not hand-rolled flex rows — slugs live in their own
 *  column so they share one x-position at every hierarchy depth, and the depth
 *  indent is applied to the NAME CELL's inner wrapper only, never to the row, so
 *  every other cell stays on the column grid and row heights stay uniform. */
export function CategoryTree({
  rows,
  counts,
  onRename,
  onReparent,
  onDelete
}: {
  rows: CategoryNode[]
  counts: Record<string, number>
  onRename: (slug: string, name: string) => void
  onReparent: (slug: string, parent: string | null) => void
  onDelete: (node: CategoryNode) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <Table>
        <TableHeader>
          <TableRow className="border-border/60">
            <TableHead>Name</TableHead>
            <TableHead className="w-48">Slug</TableHead>
            <TableHead className="w-28">Used by</TableHead>
            <TableHead className="w-52">Move to</TableHead>
            <TableHead className="w-14">
              <span className="sr-only">Delete</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((node) => {
            const used = counts[node.slug] ?? 0
            const banned = descendantsOf(rows, node.slug)
            return (
              <TableRow key={node.slug} className="border-border/40">
                <TableCell className="py-3">
                  {/* Indent on the inner wrapper only — the cell keeps its standard
                      padding so the Name column edge never moves (#385). */}
                  <div
                    className="flex"
                    style={{ paddingLeft: `${node.depth * 20}px` }}
                  >
                    <input
                      key={`name:${node.slug}:${node.name}`}
                      defaultValue={node.name}
                      aria-label={`Name of ${node.slug}`}
                      className="w-full bg-transparent text-[15px] font-medium outline-none focus:underline"
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v && v !== node.name) onRename(node.slug, v)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')
                          (e.target as HTMLInputElement).blur()
                      }}
                    />
                  </div>
                </TableCell>
                <TableCell className="py-3 text-[13px] text-muted-foreground">
                  /{node.slug}
                </TableCell>
                <TableCell className="py-3 text-[13px] text-muted-foreground">
                  {used > 0
                    ? `${used} ${used === 1 ? 'entry' : 'entries'}`
                    : 'unused'}
                </TableCell>
                <TableCell className="py-3">
                  <Select
                    value={node.parent ?? 'none'}
                    onValueChange={(v) =>
                      onReparent(node.slug, v === 'none' ? null : v)
                    }
                  >
                    <SelectTrigger className="h-8 w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Top level</SelectItem>
                      {rows
                        .filter((o) => !banned.has(o.slug))
                        .map((o) => (
                          <SelectItem key={o.slug} value={o.slug}>
                            {o.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="py-3 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${node.name}`}
                    onClick={() => onDelete(node)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
