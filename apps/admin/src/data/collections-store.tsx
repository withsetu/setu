import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import type { ReactNode } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { BUILT_IN_COLLECTIONS } from './collections'
import type { CollectionDescriptor } from './collections'

const apiBase = import.meta.env.VITE_SETU_API ?? ''

// Function-property syntax (not method syntax): consumers destructure `reload`; method
// syntax trips unbound-method at every call site. Same reason as taxonomy-store.tsx.
export interface CollectionsContextValue {
  /** The site's declared collections. Falls back to the two built-ins while loading and
   *  after a failed read, so no consumer ever renders an empty content sidebar. */
  collections: CollectionDescriptor[]
  /** True until the first read settles — loading is not the same as "only the built-ins". */
  loading: boolean
  /** True when the LAST read rejected, so `collections` is the built-in fallback rather
   *  than the site's real set. Lets a consumer tell "this site declares only post/page"
   *  from "we could not find out" (§4 row 22).
   *  Enforced by apps/admin/test/collections-store.test.tsx. */
  failed: boolean
  /** Re-run the read. The retry the `failed` flag owes the user — nothing else re-reads
   *  the collection set, so a transient failure would otherwise last until a full reload. */
  reload: () => Promise<void>
}

const CollectionsContext = createContext<CollectionsContextValue | null>(null)

export function CollectionsProvider({ children }: { children: ReactNode }) {
  const [collections, setCollections] =
    useState<CollectionDescriptor[]>(BUILT_IN_COLLECTIONS)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`${apiBase}/api/collections`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as {
        collections?: CollectionDescriptor[]
      }
      // An empty array is a real answer only if the server sent one; a malformed body
      // falls back rather than blanking the sidebar.
      if (!Array.isArray(data.collections))
        throw new Error('malformed response')
      setCollections(data.collections)
      setFailed(false)
    } catch {
      setCollections(BUILT_IN_COLLECTIONS)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // The rejection is handled inside `reload` (it sets `failed`, which AppSidebar
    // surfaces) — this catch only keeps a re-throw from escaping the effect unreported.
    void reload().catch(() => setFailed(true))
  }, [reload])

  const value = useMemo(
    () => ({ collections, loading, failed, reload }),
    [collections, loading, failed, reload]
  )
  return (
    <CollectionsContext.Provider value={value}>
      {children}
    </CollectionsContext.Provider>
  )
}

/** The site's declared collections. Outside the provider (tests, isolated stories) this
 *  degrades to the built-ins rather than throwing, because every consumer only ever needs
 *  a list to render — a hard throw here would take down screens that work fine on
 *  post/page alone. */
export function useCollections(): CollectionsContextValue {
  return (
    useContext(CollectionsContext) ?? {
      collections: BUILT_IN_COLLECTIONS,
      loading: false,
      failed: false,
      reload: () => Promise.resolve()
    }
  )
}
