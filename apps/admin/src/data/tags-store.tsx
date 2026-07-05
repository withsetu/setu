import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import type { ReactNode } from 'react'
import { bulkAddTag, bulkRemoveTag, normalizeTag } from '@setu/core'
import { useServices } from './store'
import { useIndex } from './index-store'

// Function-property syntax (not method syntax): consumers destructure these closures
// (`const { rename } = useTags()`); method syntax trips unbound-method on every use.
export interface TagsContextValue {
  counts: Record<string, number>
  rename: (
    from: string,
    to: string
  ) => Promise<{ applied: number; merged: boolean }>
  remove: (tag: string) => Promise<{ applied: number }>
}

const TagsContext = createContext<TagsContextValue | null>(null)

export function TagsProvider({ children }: { children: ReactNode }) {
  const { bulk } = useServices()
  const index = useIndex()
  const [counts, setCounts] = useState<Record<string, number>>({})

  const refreshCounts = useCallback(() => {
    void index
      .tagCounts()
      .then(setCounts)
      .catch(() => {})
  }, [index])

  useEffect(() => {
    refreshCounts()
  }, [refreshCounts])

  const rename = useCallback(
    async (from: string, to: string) => {
      const target = normalizeTag(to)
      if (target === '' || target === from) return { applied: 0, merged: false }
      const merged = counts[target] !== undefined
      const refs = await index.entriesByTag(from)
      const res = await bulk.applyMetadata(
        refs,
        (m) => bulkAddTag(bulkRemoveTag(m, from), target),
        `tags: rename ${from} → ${target}`
      )
      for (const ref of res.applied)
        await index.reindexEntry(ref).catch(() => {})
      if (res.committedSha)
        await index.markSyncedAt(res.committedSha).catch(() => {})
      refreshCounts()
      return { applied: res.applied.length, merged }
    },
    [bulk, index, counts, refreshCounts]
  )

  const remove = useCallback(
    async (tag: string) => {
      const refs = await index.entriesByTag(tag)
      const res = await bulk.applyMetadata(
        refs,
        (m) => bulkRemoveTag(m, tag),
        `tags: delete ${tag}`
      )
      for (const ref of res.applied)
        await index.reindexEntry(ref).catch(() => {})
      if (res.committedSha)
        await index.markSyncedAt(res.committedSha).catch(() => {})
      refreshCounts()
      return { applied: res.applied.length }
    },
    [bulk, index, refreshCounts]
  )

  const value = useMemo<TagsContextValue>(
    () => ({ counts, rename, remove }),
    [counts, rename, remove]
  )
  return <TagsContext.Provider value={value}>{children}</TagsContext.Provider>
}

export function useTags(): TagsContextValue {
  const ctx = useContext(TagsContext)
  if (ctx === null)
    throw new Error('useTags must be used within a TagsProvider')
  return ctx
}
