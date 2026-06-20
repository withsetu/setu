import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Category } from '@setu/core'
import { createTaxonomyService } from '@setu/core'
import { useServices } from './store'

/** The editor's identity stamped on taxonomy commits (matches the editor's). */
const TAXONOMY_AUTHOR = { name: 'Local', email: 'local@setu.dev' }

export interface TaxonomyContextValue {
  categories: Category[]
  /** Create a category; returns the minted slug. */
  create(input: { name: string; parent: string | null }): Promise<string>
  renameLabel(slug: string, name: string): Promise<void>
  reparent(slug: string, parent: string | null): Promise<void>
}

const TaxonomyContext = createContext<TaxonomyContextValue | null>(null)

export function TaxonomyProvider({ children }: { children: ReactNode }) {
  const { git } = useServices()
  const service = useMemo(() => createTaxonomyService({ git, author: TAXONOMY_AUTHOR }), [git])
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    void service.read().then(setCategories).catch(() => {})
  }, [service])

  const create = useCallback(
    async (input: { name: string; parent: string | null }) => {
      const { categories: next, slug } = await service.create(input)
      setCategories(next)
      return slug
    },
    [service],
  )
  const renameLabel = useCallback(
    async (slug: string, name: string) => setCategories(await service.renameLabel(slug, name)),
    [service],
  )
  const reparent = useCallback(
    async (slug: string, parent: string | null) => setCategories(await service.reparent(slug, parent)),
    [service],
  )

  const value = useMemo<TaxonomyContextValue>(
    () => ({ categories, create, renameLabel, reparent }),
    [categories, create, renameLabel, reparent],
  )
  return <TaxonomyContext.Provider value={value}>{children}</TaxonomyContext.Provider>
}

export function useTaxonomy(): TaxonomyContextValue {
  const ctx = useContext(TaxonomyContext)
  if (ctx === null) throw new Error('useTaxonomy must be used within a TaxonomyProvider')
  return ctx
}
