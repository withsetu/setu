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

export interface TaxonomyContextValue {
  categories: Category[]
  counts: Record<string, number>
  /** Create a category; returns the minted slug. */
  create(input: { name: string; parent: string | null }): Promise<string>
  renameLabel(slug: string, name: string): Promise<void>
  reparent(slug: string, parent: string | null): Promise<void>
  remove(slug: string): Promise<void>
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

  const refreshCounts = useCallback(() => {
    void index
      .categoryCounts()
      .then(setCounts)
      .catch(() => {})
  }, [index])

  useEffect(() => {
    void service
      .read()
      .then(setCategories)
      .catch(() => {})
    refreshCounts()
  }, [service, refreshCounts])

  const create = useCallback(
    async (input: { name: string; parent: string | null }) => {
      const { categories: next, slug } = await service.create(input)
      setCategories(next)
      refreshCounts()
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
      const { categories: next } = await deleter.remove(slug)
      setCategories(next)
      refreshCounts()
    },
    [deleter, refreshCounts]
  )

  const value = useMemo<TaxonomyContextValue>(
    () => ({ categories, counts, create, renameLabel, reparent, remove }),
    [categories, counts, create, renameLabel, reparent, remove]
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
