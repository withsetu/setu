import { useMemo, useState } from 'react'
import type { CategoryNode } from '@setu/core'
import { buildTree } from '@setu/core'
import { PageHeader } from '../shell/PageHeader'
import { useTaxonomy } from '../data/taxonomy-store'
import { useNotify } from '../ui/notify'

function flatten(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

export function Categories() {
  const { categories, create, renameLabel, reparent } = useTaxonomy()
  const notify = useNotify()
  const rows = useMemo(() => flatten(buildTree(categories)), [categories])
  const [name, setName] = useState('')

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    await create({ name: trimmed, parent: null })
    setName('')
  }

  const onReparent = async (slug: string, parent: string) => {
    try {
      await reparent(slug, parent || null)
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="categories-screen">
      <PageHeader title="Categories" subtitle="Organize how posts are grouped." />
      <div className="category-new">
        <input
          type="text"
          placeholder="New category"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
          }}
        />
        <button type="button" onClick={() => void add()}>Add</button>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No categories yet — add one above.</p>
      ) : (
        <ul className="category-manage-list">
          {rows.map((node) => (
            <li key={node.slug} className="category-manage-row" style={{ paddingLeft: `${node.depth * 16}px` }}>
              <input
                key={`name:${node.slug}:${node.name}`}
                className="category-name-input"
                defaultValue={node.name}
                aria-label={`Name of ${node.slug}`}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== node.name) void renameLabel(node.slug, v)
                }}
              />
              <label className="category-parent">
                <span className="muted">Parent</span>
                <select value={node.parent ?? ''} aria-label={`Parent of ${node.slug}`} onChange={(e) => void onReparent(node.slug, e.target.value)}>
                  <option value="">None</option>
                  {rows
                    .filter((o) => o.slug !== node.slug)
                    .map((o) => (
                      <option key={o.slug} value={o.slug}>{o.name}</option>
                    ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
