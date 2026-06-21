import { useMemo, useState } from 'react'
import type { CategoryNode } from '@setu/core'
import { buildTree } from '@setu/core'
import { useTaxonomy } from '../data/taxonomy-store'

/** Flatten the tree depth-first so it renders as indented checkbox rows. */
function flatten(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

export function CategoryField({
  selected,
  onChange,
  editable,
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
  const visible = fq === '' ? rows : rows.filter((n) => n.name.toLowerCase().includes(fq))

  const toggle = (slug: string) =>
    onChange(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug])

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
    <div className="category-field">
      <div className="category-tree" role="group" aria-label="Categories">
        {rows.length > 0 && (
          <input
            type="text"
            className="category-filter"
            placeholder="Filter categories"
            aria-label="Filter categories"
            value={filter}
            disabled={!editable}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
        {rows.length === 0 && <p className="muted">No categories yet — add one below.</p>}
        {visible.map((node) => (
          <label key={node.slug} className="category-row" style={{ paddingLeft: `${node.depth * 16}px` }}>
            <input
              type="checkbox"
              checked={selected.includes(node.slug)}
              disabled={!editable}
              onChange={() => toggle(node.slug)}
            />
            <span>{node.name}</span>
          </label>
        ))}
      </div>
      <div className="category-new">
        {error && <p role="alert" className="error">{error}</p>}
        <input
          type="text"
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
        <select value={parent} disabled={!editable} onChange={(e) => setParent(e.target.value)} aria-label="Parent category">
          <option value="">No parent</option>
          {rows.map((node) => (
            <option key={node.slug} value={node.slug}>
              {' '.repeat(node.depth * 2)}
              {node.name}
            </option>
          ))}
        </select>
        <button type="button" disabled={!editable} onClick={() => void submit()}>
          Add
        </button>
      </div>
    </div>
  )
}
