import { useMemo, useState } from 'react'
import type { CategoryNode } from '@setu/core'
import { buildTree } from '@setu/core'
import { useTaxonomy } from '../../data/taxonomy-store'
import { useNotify } from '../../ui/notify'
import { NewCategoryForm } from './NewCategoryForm'
import { CategoryTree, flatten } from './CategoryTree'
import { DeleteCategoryDialog } from './DeleteCategoryDialog'

export function CategoriesTab() {
  const { categories, counts, renameLabel, reparent } = useTaxonomy()
  const notify = useNotify()
  const rows = useMemo(() => flatten(buildTree(categories)), [categories])
  const [pendingDelete, setPendingDelete] = useState<CategoryNode | null>(null)

  const onReparent = async (slug: string, parent: string | null) => {
    try {
      await reparent(slug, parent)
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      <NewCategoryForm />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No categories yet — add one above.
        </p>
      ) : (
        <CategoryTree
          rows={rows}
          counts={counts}
          onRename={(slug, name) => void renameLabel(slug, name)}
          onReparent={onReparent}
          onDelete={setPendingDelete}
        />
      )}
      <DeleteCategoryDialog
        node={pendingDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
