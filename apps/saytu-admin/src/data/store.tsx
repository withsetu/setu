import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { DataPort, DraftInput, TiptapDoc } from '@saytu/core'
import { createMemoryDataPort } from '@saytu/db-memory'

const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** Sample content so the admin has something to show before real persistence. */
export const seedDrafts: DraftInput[] = [
  { collection: 'post', locale: 'en', slug: 'the-quiet-week', content: doc('The quiet week before a launch.'), metadata: { title: 'The quiet week before a launch', status: 'published' } },
  { collection: 'post', locale: 'en', slug: 'release-notes', content: doc('What shipped.'), metadata: { title: 'Release notes', status: 'draft' } },
  { collection: 'page', locale: 'en', slug: 'about', content: doc('About us.'), metadata: { title: 'About', status: 'published' } },
]

/** The app's DataPort (in-memory, seeded). Swapped for a real adapter later. */
export function createAppDataPort(): DataPort {
  return createMemoryDataPort(seedDrafts)
}

const DataContext = createContext<DataPort | null>(null)

export function DataProvider({ adapter, children }: { adapter: DataPort; children: ReactNode }) {
  return <DataContext.Provider value={adapter}>{children}</DataContext.Provider>
}

export function useData(): DataPort {
  const ctx = useContext(DataContext)
  if (ctx === null) throw new Error('useData must be used within a DataProvider')
  return ctx
}
