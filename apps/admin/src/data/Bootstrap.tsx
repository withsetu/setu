import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createIdbDataPort } from '@setu/db-idb'
import { createIdbGitPort } from '@setu/git-idb'
import { createHttpGitPort } from '@setu/git-http'
import { bootstrapServices, ServicesProvider } from './store'
import type { Services } from './store'

/** Opens the persistent (IndexedDB) adapters, seeds-if-empty, and provides the
 *  services once ready. Falls back to in-memory storage (non-persistent, but the
 *  app still works) if IndexedDB can't be opened. */
export function Bootstrap({ children }: { children: ReactNode }) {
  const [services, setServices] = useState<Services | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const apiBase = import.meta.env.VITE_SETU_API
      let ready: Services
      if (apiBase) {
        // Server-backed GitPort (Cut A): Publish commits to the real repo via the API.
        // Drafts stay in-browser (IndexedDB) this cut.
        const data = await createIdbDataPort()
        const git = createHttpGitPort({ baseUrl: apiBase })
        ready = await bootstrapServices(data, git)
      } else {
        try {
          const data = await createIdbDataPort()
          const git = await createIdbGitPort()
          ready = await bootstrapServices(data, git)
        } catch (err) {
          console.error('IndexedDB unavailable — using in-memory storage for this session.', err)
          ready = await bootstrapServices(createMemoryDataPort(), createMemoryGitPort())
        }
      }
      if (live) setServices(ready)
    })()
    return () => {
      live = false
    }
  }, [])

  if (services === null) {
    return (
      <div className="boot-loading" role="status" aria-live="polite">
        Loading…
      </div>
    )
  }
  return <ServicesProvider services={services}>{children}</ServicesProvider>
}
