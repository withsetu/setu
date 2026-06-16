import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@saytu/db-memory'
import { createMemoryGitPort } from '@saytu/git-memory'
import { createIdbDataPort } from '@saytu/db-idb'
import { createIdbGitPort } from '@saytu/git-idb'
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
      let ready: Services
      try {
        const data = await createIdbDataPort()
        const git = await createIdbGitPort()
        ready = await bootstrapServices(data, git)
      } catch (err) {
        console.error('IndexedDB unavailable — using in-memory storage for this session.', err)
        ready = await bootstrapServices(createMemoryDataPort(), createMemoryGitPort())
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
