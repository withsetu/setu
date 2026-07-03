import type { Category, CategoryNode } from './types'

/** Assemble categories into a forest. A category whose parent is null, missing,
 *  or part of a cycle becomes a root — so the function never drops a node and
 *  never loops on malformed data. Roots keep input order; depth is 0-based. */
export function buildTree(cats: Category[]): CategoryNode[] {
  const bySlug = new Map(cats.map((c) => [c.slug, c]))
  const nodes = new Map<string, CategoryNode>(
    cats.map((c) => [c.slug, { ...c, children: [], depth: 0 }])
  )

  // The parent to attach under: null when root, missing, or reachable-cycle.
  const effectiveParent = (c: Category): string | null => {
    if (c.parent === null || !bySlug.has(c.parent)) return null
    const seen = new Set<string>([c.slug])
    let p: string | null = c.parent
    while (p !== null) {
      if (seen.has(p)) return null // cycle
      seen.add(p)
      p = bySlug.get(p)?.parent ?? null
    }
    return c.parent
  }

  const roots: CategoryNode[] = []
  for (const c of cats) {
    const node = nodes.get(c.slug)!
    const ep = effectiveParent(c)
    if (ep === null) roots.push(node)
    else nodes.get(ep)!.children.push(node)
  }

  const assignDepth = (node: CategoryNode, depth: number): void => {
    node.depth = depth
    for (const child of node.children) assignDepth(child, depth + 1)
  }
  for (const r of roots) assignDepth(r, 0)
  return roots
}
