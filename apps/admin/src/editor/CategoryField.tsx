import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { CategoryNode } from '@setu/core'
import { buildTree } from '@setu/core'
import { useTaxonomy } from '../data/taxonomy-store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '@/components/ui/select'

/** Flatten the tree depth-first so it renders as indented checkbox rows. */
function flatten(
  nodes: CategoryNode[],
  out: CategoryNode[] = []
): CategoryNode[] {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

export function CategoryField({
  selected,
  onChange,
  editable
}: {
  selected: string[]
  onChange: (next: string[]) => void
  editable: boolean
}) {
  const { categories, create } = useTaxonomy()
  const rows = useMemo(() => flatten(buildTree(categories)), [categories])
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [error, setError] = useState<string | null>(null)

  const fq = filter.trim().toLowerCase()
  const visible =
    fq === '' ? rows : rows.filter((n) => n.name.toLowerCase().includes(fq))

  const toggle = (slug: string) =>
    onChange(
      selected.includes(slug)
        ? selected.filter((s) => s !== slug)
        : [...selected, slug]
    )

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setError(null)
    try {
      const slug = await create({ name: trimmed, parent: parent || null })
      if (!selected.includes(slug)) onChange([...selected, slug])
      setName('')
      setParent('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Filter categories"
            aria-label="Filter categories"
            value={filter}
            disabled={!editable}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No categories yet — add one below.
        </p>
      )}
      {rows.length > 0 && (
        <div
          className="max-h-64 space-y-0.5 overflow-y-auto"
          role="group"
          aria-label="Categories"
        >
          {visible.map((node) => (
            <label
              key={node.slug}
              className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1.5 text-sm hover:bg-muted/50"
              style={{ paddingLeft: `${4 + node.depth * 20}px` }}
            >
              <Checkbox
                checked={selected.includes(node.slug)}
                disabled={!editable}
                aria-label={node.name}
                onCheckedChange={() => toggle(node.slug)}
              />
              <span>{node.name}</span>
            </label>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Input
            className="h-9 flex-1"
            placeholder="New category"
            value={name}
            disabled={!editable}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <Button size="sm" disabled={!editable} onClick={() => void submit()}>
            Add
          </Button>
        </div>
        {rows.length > 0 && (
          <Select
            value={parent || 'none'}
            disabled={!editable}
            onValueChange={(v) => setParent(v === 'none' ? '' : v)}
          >
            <SelectTrigger className="h-9 w-full" aria-label="Parent category">
              <SelectValue placeholder="No parent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No parent</SelectItem>
              {rows.map((node) => (
                <SelectItem key={node.slug} value={node.slug}>
                  <span style={{ paddingLeft: `${node.depth * 12}px` }}>
                    {node.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}
