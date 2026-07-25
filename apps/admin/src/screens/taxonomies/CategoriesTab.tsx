import { useMemo, useState } from 'react'
import type { CategoryNode } from '@setu/core'
import { buildTree, TaxonomyError } from '@setu/core'
import { Button } from '@/components/ui/button'
import { useTaxonomy } from '../../data/taxonomy-store'
import { useNotify } from '../../ui/notify'
import { connectionError } from '../../ui/error-message'
import { NewCategoryForm } from './NewCategoryForm'
import { CategoryTree, CategoryTreeSkeleton, flatten } from './CategoryTree'
import { DeleteCategoryDialog } from './DeleteCategoryDialog'

export function CategoriesTab() {
  const {
    categories,
    counts,
    loading,
    categoriesFailed,
    countsFailed,
    reload,
    renameLabel,
    reparent
  } = useTaxonomy()
  const notify = useNotify()
  const rows = useMemo(() => flatten(buildTree(categories)), [categories])
  const [pendingDelete, setPendingDelete] = useState<CategoryNode | null>(null)

  const onReparent = async (slug: string, parent: string | null) => {
    try {
      await reparent(slug, parent)
    } catch (e) {
      // #852: a TaxonomyError (e.g. "Move would create a cycle") is meaningful —
      // show it; a transport failure is not — curate it.
      notify.error(
        e instanceof TaxonomyError
          ? e.message
          : connectionError('move the category')
      )
    }
  }

  // Matches onReparent above: a failed rename used to go straight to the store as
  // `void renameLabel(...)`, reporting nothing (#837).
  const onRename = async (slug: string, name: string) => {
    try {
      await renameLabel(slug, name)
    } catch (e) {
      // #852: TaxonomyError → meaningful validation message; else transport → curate.
      notify.error(
        e instanceof TaxonomyError
          ? e.message
          : connectionError('rename the category')
      )
    }
  }

  return (
    <div>
      <NewCategoryForm />
      {/* #582: paint the tree shell with skeleton rows while categories load —
          the empty state is reserved for a load that FINISHED with zero rows. */}
      {/* #914 / §4 row 22: the failure branch comes BEFORE the empty one. A registry read
          that rejected used to land on "No categories yet — add one above.", inviting the
          user to rebuild a taxonomy that is merely unreadable. Covered by the '#914'
          cases in apps/admin/test/CategoriesTab.test.tsx. */}
      {countsFailed && !loading && !categoriesFailed && (
        <p className="text-sm text-destructive" role="status">
          Couldn’t load usage counts — the “Used by” column may be wrong.
        </p>
      )}
      {loading ? (
        <CategoryTreeSkeleton />
      ) : categoriesFailed ? (
        <div className="text-sm text-destructive">
          <p>Couldn’t load categories. They may still be there.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void reload()}
          >
            Try again
          </Button>
        </div>
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
