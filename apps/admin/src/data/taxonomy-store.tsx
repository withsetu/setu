import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import type { ReactNode } from 'react'
import type { Category } from '@setu/core'
import { createTaxonomyService, createCategoryDeleter } from '@setu/core'
import { useServices } from './store'
import { useIndex } from './index-store'

/** The editor's identity stamped on taxonomy commits (matches the editor's). */
const TAXONOMY_AUTHOR = { name: 'Local', email: 'local@setu.dev' }

// Function-property syntax (not method syntax): consumers destructure these closures
// (`const { create } = useTaxonomy()`); method syntax trips unbound-method on every use.
export interface TaxonomyContextValue {
  categories: Category[]
  counts: Record<string, number>
  /** True until the initial categories + counts reads settle — loading ≠ empty (#582). */
  loading: boolean
  /** Create a category; returns the minted slug. */
  create: (input: { name: string; parent: string | null }) => Promise<string>
  renameLabel: (slug: string, name: string) => Promise<void>
  reparent: (slug: string, parent: string | null) => Promise<void>
  /** Delete a category. Resolves with the entries that could NOT be stripped
   *  (#713/#714b) — they keep a dangling reference to the deleted slug, so the
   *  caller must tell the user rather than report an unqualified success. */
  remove: (slug: string) => Promise<{ skippedCount: number }>
}

const TaxonomyContext = createContext<TaxonomyContextValue | null>(null)

export function TaxonomyProvider({ children }: { children: ReactNode }) {
  const { git, data, read } = useServices()
  const index = useIndex()
  const service = useMemo(
    () => createTaxonomyService({ git, author: TAXONOMY_AUTHOR }),
    [git]
  )
  const deleter = useMemo(
    () =>
      createCategoryDeleter({
        git,
        data,
        read,
        index,
        author: TAXONOMY_AUTHOR
      }),
    [git, data, read, index]
  )
  const [categories, setCategories] = useState<Category[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const refreshCounts = useCallback(
    () =>
      index
        .categoryCounts()
        .then(setCounts)
        .catch(() => {}),
    [index]
  )

  useEffect(() => {
    // #582: flip `loading` only once both initial reads settle (success or failure),
    // so screens can tell "still loading" from "loaded empty".
    void Promise.all([
      service
        .read()
        .then(setCategories)
        .catch(() => {}),
      refreshCounts()
    ]).then(() => setLoading(false))
  }, [service, refreshCounts])

  const create = useCallback(
    async (input: { name: string; parent: string | null }) => {
      const { categories: next, slug } = await service.create(input)
      setCategories(next)
      void refreshCounts()
      return slug
    },
    [service, refreshCounts]
  )
  const renameLabel = useCallback(
    async (slug: string, name: string) =>
      setCategories(await service.renameLabel(slug, name)),
    [service]
  )
  const reparent = useCallback(
    async (slug: string, parent: string | null) =>
      setCategories(await service.reparent(slug, parent)),
    [service]
  )
  const remove = useCallback(
    async (slug: string) => {
      const { categories: next, skipped } = await deleter.remove(slug)
      setCategories(next)
      void refreshCounts()
      return { skippedCount: skipped.length }
    },
    [deleter, refreshCounts]
  )

  const value = useMemo<TaxonomyContextValue>(
    () => ({
      categories,
      counts,
      loading,
      create,
      renameLabel,
      reparent,
      remove
    }),
    [categories, counts, loading, create, renameLabel, reparent, remove]
  )
  return (
    <TaxonomyContext.Provider value={value}>
      {children}
    </TaxonomyContext.Provider>
  )
}

export function useTaxonomy(): TaxonomyContextValue {
  const ctx = useContext(TaxonomyContext)
  if (ctx === null)
    throw new Error('useTaxonomy must be used within a TaxonomyProvider')
  return ctx
}
