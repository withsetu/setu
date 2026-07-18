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
import { Skeleton } from '@/components/ui/skeleton'
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

/** Shared by the real tree and its loading skeleton so the two can never drift —
 *  identical header = zero layout shift when data lands (#582). */
function CategoryTreeHead() {
  return (
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
  )
}

/** Fixed shape for the loading tree: a couple of top-level rows with indented
 *  children — reads as a hierarchy at a glance, matches typical data. */
const SKELETON_ROWS: Array<{ depth: number; name: string }> = [
  { depth: 0, name: 'w-28' },
  { depth: 1, name: 'w-36' },
  { depth: 1, name: 'w-24' },
  { depth: 0, name: 'w-32' },
  { depth: 1, name: 'w-28' }
]

/** Loading placeholder shaped like the category tree: same table, same column
 *  widths and cell paddings, skeleton lines with tree-indent hints on the name
 *  column. The Move-to skeleton matches the real SelectTrigger box (h-8), which
 *  governs row height — nothing shifts when data lands (#582, mirrors #572). */
export function CategoryTreeSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <Table>
        <CategoryTreeHead />
        <TableBody>
          {SKELETON_ROWS.map((r, i) => (
            <TableRow key={i} className="border-border/40">
              <TableCell className="py-3">
                {/* Same inner-wrapper indent as the real name cell (#385). */}
                <div
                  className="flex"
                  style={{ paddingLeft: `${r.depth * 20}px` }}
                >
                  <div className="flex h-8 items-center">
                    <Skeleton className={`h-4 ${r.name}`} />
                  </div>
                </div>
              </TableCell>
              <TableCell className="py-3">
                <div className="flex h-8 items-center">
                  <Skeleton className="h-3.5 w-24" />
                </div>
              </TableCell>
              <TableCell className="py-3">
                <div className="flex h-8 items-center">
                  <Skeleton className="h-3.5 w-16" />
                </div>
              </TableCell>
              <TableCell className="py-3">
                <Skeleton className="h-8 w-44" />
              </TableCell>
              <TableCell className="py-3">
                <Skeleton className="ml-auto size-8" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
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
        <CategoryTreeHead />
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
                  {/* #554: slugs derive from free-text names — cap + truncate so a long one
                      can't stretch the table; full slug on hover. */}
                  <div title={`/${node.slug}`} className="max-w-48 truncate">
                    /{node.slug}
                  </div>
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
