import { useMemo, useState } from 'react'
import type { CategoryNode } from '@setu/core'
import { buildTree } from '@setu/core'
import { useTaxonomy } from '../../data/taxonomy-store'
import { useNotify } from '../../ui/notify'
import { NewCategoryForm } from './NewCategoryForm'
import { CategoryTree, CategoryTreeSkeleton, flatten } from './CategoryTree'
import { DeleteCategoryDialog } from './DeleteCategoryDialog'

export function CategoriesTab() {
  const { categories, counts, loading, renameLabel, reparent } = useTaxonomy()
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

  // Matches onReparent above: a failed rename used to go straight to the store as
  // `void renameLabel(...)`, reporting nothing (#837).
  const onRename = async (slug: string, name: string) => {
    try {
      await renameLabel(slug, name)
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      <NewCategoryForm />
      {/* #582: paint the tree shell with skeleton rows while categories load —
          the empty state is reserved for a load that FINISHED with zero rows. */}
      {loading ? (
        <CategoryTreeSkeleton />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No categories yet — add one above.
        </p>
      ) : (
        <CategoryTree
          rows={rows}
          counts={counts}
          onRename={(slug, name) => void onRename(slug, name)}
          onReparent={(slug, parent) => void onReparent(slug, parent)}
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
