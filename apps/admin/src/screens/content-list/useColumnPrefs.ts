import { useCallback, useState } from 'react'

export type ColumnKey =
  | 'status'
  | 'tags'
  | 'categories'
  | 'featured'
  | 'seo'
  | 'locale'
  | 'updated'
const KEY = 'setu-list-columns'

function load(): Partial<Record<ColumnKey, boolean>> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    // localStorage is untrusted at the type level (stale shape from an older app
    // version, or hand-edited) — JSON.parse returns `any`, so validate the shape
    // instead of trusting it wholesale (@typescript-eslint/no-unsafe-return caught the
    // previous bare `return JSON.parse(raw)`).
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed
  } catch {
    return {}
  }
}

export function useColumnPrefs(multilingual: boolean): {
  visible: Record<ColumnKey, boolean>
  toggle: (k: ColumnKey) => void
} {
  const [stored, setStored] =
    useState<Partial<Record<ColumnKey, boolean>>>(load)
  const defaults: Record<ColumnKey, boolean> = {
    status: true,
    tags: true,
    categories: true,
    featured: true,
    seo: true,
    updated: true,
    locale: multilingual
  }
  const visible: Record<ColumnKey, boolean> = {
    status: stored.status ?? defaults.status,
    tags: stored.tags ?? defaults.tags,
    categories: stored.categories ?? defaults.categories,
    featured: stored.featured ?? defaults.featured,
    seo: stored.seo ?? defaults.seo,
    updated: stored.updated ?? defaults.updated,
    locale: stored.locale ?? defaults.locale
  }
  const toggle = useCallback(
    (k: ColumnKey) => {
      setStored((prev) => {
        const base: Record<ColumnKey, boolean> = {
          status: prev.status ?? true,
          tags: prev.tags ?? true,
          categories: prev.categories ?? true,
          featured: prev.featured ?? true,
          seo: prev.seo ?? true,
          updated: prev.updated ?? true,
          locale: prev.locale ?? multilingual
        }
        const next = { ...prev, [k]: !base[k] }
        try {
          localStorage.setItem(KEY, JSON.stringify(next))
        } catch {
          /* private mode */
        }
        return next
      })
    },
    [multilingual]
  )
  return { visible, toggle }
}
