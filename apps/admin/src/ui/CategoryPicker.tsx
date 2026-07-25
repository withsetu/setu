import { useMemo } from 'react'
import type { CategoryNode } from '@setu/core'
import { buildTree } from '@setu/core'
import { useTaxonomy } from '../data/taxonomy-store'
import { Combobox } from './Combobox'

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

export function CategoryPicker({
  value,
  onChange,
  onSubmit,
  placeholder = 'Category…',
  ariaLabel,
  disabled = false
}: {
  value: string
  onChange: (text: string) => void
  onSubmit: (slug: string) => void
  placeholder?: string
  ariaLabel: string
  disabled?: boolean
}) {
  const { categories, categoriesFailed } = useTaxonomy()
  const rows = useMemo(() => flatten(buildTree(categories)), [categories])
  const q = value.trim().toLowerCase()
  const items = rows
    .filter(
      (r) =>
        q === '' ||
        r.name.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q)
    )
    .map((r) => ({ value: r.slug, label: `${'  '.repeat(r.depth)}${r.name}` }))

  return (
    <Combobox
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      items={items}
      allowFreeText={false}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      disabled={disabled}
      // #914 / §4 row 22: `allowFreeText={false}` means an empty list is a dead end, so
      // "the registry read failed" must not render as "there are no categories". Unlike
      // TagAutocomplete there is no keystroke-driven retry here — the registry is read
      // once — so the text points at the only recovery the user has.
      // Covered by apps/admin/test/category-picker.test.tsx.
      hint={
        categoriesFailed
          ? 'Couldn’t load categories — reload the page to try again.'
          : undefined
      }
    />
  )
}
