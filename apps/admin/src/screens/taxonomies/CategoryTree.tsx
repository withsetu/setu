import { useMemo, useState } from 'react'
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

/** Precomputed reparent lookups for a `rows` set. */
export interface ReparentIndex {
  /** slug → the set of invalid reparent targets for that slug: the node itself
   *  plus all its descendants (choosing any of them would form a cycle). */
  bannedBySlug: Map<string, Set<string>>
  /** slug → display name, for labelling a closed row's current parent. */
  nameBySlug: Map<string, string>
}

/**
 * #592: build every node's banned-target set ONCE per `rows` change, in a single
 * O(n) descendant pass, so each row does an O(1) `bannedBySlug.get(slug)` lookup.
 *
 * The old code called an O(n²) descendant fixpoint *inside* the per-row `.map()`
 * (O(n³) per render → ~3.4M iterations and a 7-8s freeze at ~150 categories).
 */
export function buildReparentIndex(rows: CategoryNode[]): ReparentIndex {
  const childrenBySlug = new Map<string, string[]>()
  const nameBySlug = new Map<string, string>()
  for (const r of rows) {
    nameBySlug.set(r.slug, r.name)
    if (r.parent) {
      const kids = childrenBySlug.get(r.parent)
      if (kids) kids.push(r.slug)
      else childrenBySlug.set(r.parent, [r.slug])
    }
  }

  const bannedBySlug = new Map<string, Set<string>>()
  // Memoise before recursing so malformed parent-cycles terminate (rows from
  // buildTree are acyclic, but fail safe rather than loop).
  const collect = (slug: string): Set<string> => {
    const cached = bannedBySlug.get(slug)
    if (cached) return cached
    const banned = new Set<string>([slug])
    bannedBySlug.set(slug, banned)
    for (const child of childrenBySlug.get(slug) ?? [])
      for (const d of collect(child)) banned.add(d)
    return banned
  }
  for (const r of rows) collect(r.slug)

  return { bannedBySlug, nameBySlug }
}

/**
 * #592: the per-row "Move to" control. Its full option list (up to ~n items) is
 * built ONLY while the Select is open — never eagerly for all ~150 rows at once
 * (which mounted ~22k Radix items). While closed it renders just the currently
 * selected parent so Radix can still label the trigger with the parent's name.
 */
function ReparentSelect({
  node,
  rows,
  banned,
  parentName,
  onReparent
}: {
  node: CategoryNode
  rows: CategoryNode[]
  banned: Set<string>
  parentName: string | undefined
  onReparent: (slug: string, parent: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Select
      open={open}
      onOpenChange={setOpen}
      value={node.parent ?? 'none'}
      onValueChange={(v) => onReparent(node.slug, v === 'none' ? null : v)}
    >
      <SelectTrigger className="h-8 w-44" aria-label={`Move ${node.name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Top level</SelectItem>
        {open
          ? rows
              .filter((o) => !banned.has(o.slug))
              .map((o) => (
                <SelectItem key={o.slug} value={o.slug}>
                  {o.name}
                </SelectItem>
              ))
          : node.parent && (
              <SelectItem value={node.parent}>
                {parentName ?? node.parent}
              </SelectItem>
            )}
      </SelectContent>
    </Select>
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
  // #592: compute banned-target sets + name lookup once per rows change.
  const { bannedBySlug, nameBySlug } = useMemo(
    () => buildReparentIndex(rows),
    [rows]
  )
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
            const banned = bannedBySlug.get(node.slug) ?? new Set([node.slug])
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
                  <ReparentSelect
                    node={node}
                    rows={rows}
                    banned={banned}
                    parentName={
                      node.parent ? nameBySlug.get(node.parent) : undefined
                    }
                    onReparent={onReparent}
                  />
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
