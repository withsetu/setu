import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type {
  AuthoringService,
  BulkService,
  DataPort,
  DraftInput,
  GitPort,
  IndexPort,
  MediaIndexService,
  PublishService,
  ReadService,
  SubmissionPort,
  TiptapDoc
} from '@setu/core'
import {
  createAuthoringService,
  createBulkService,
  createMediaIndexService,
  createPublishService,
  createReadService
} from '@setu/core'
import { registry } from '../blocks/registry'
import {
  createMemoryDataPort,
  createMemoryIndexPort,
  createMemoryMediaIndexPort,
  createMemorySubmissionPort
} from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'

/** Editor identity stamped on bulk commits: fallback identity; the api stamps the real session
 *  user on commit routes (#382). */
export const OWNER_AUTHOR = { name: 'Local', email: 'local@setu.dev' }

const doc = (text: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
})

/** Sample content so the admin has something to show before real persistence. */
export const seedDrafts: DraftInput[] = [
  {
    collection: 'post',
    locale: 'en',
    slug: 'the-quiet-week',
    content: doc('The quiet week before a launch.'),
    metadata: { title: 'The quiet week before a launch', status: 'published' }
  },
  {
    collection: 'post',
    locale: 'en',
    slug: 'release-notes',
    content: doc('What shipped.'),
    metadata: { title: 'Release notes', status: 'draft' }
  },
  {
    collection: 'page',
    locale: 'en',
    slug: 'about',
    content: doc('About us.'),
    metadata: { title: 'About', status: 'published' }
  }
]

/** The composed in-browser services the admin runs on. */
export interface Services {
  data: DataPort
  git: GitPort
  /** The queryable content index. Persistent + cross-tab (idb) in the app; an
   *  in-memory default in tests. Shared so one tab's publish is visible in
   *  another on navigation, not stale until refresh. */
  index: IndexPort
  read: ReadService
  authoring: AuthoringService
  publish: PublishService
  bulk: BulkService
  mediaIndex: MediaIndexService
  submissions: SubmissionPort
}

/** Build the in-browser services bundle around a DataPort + GitPort. The index
 *  port defaults to in-memory (tests); the app passes the persistent idb one. */
export function servicesFor(
  data: DataPort,
  git: GitPort,
  index: IndexPort = createMemoryIndexPort(),
  mediaIndex: MediaIndexService = createMediaIndexService({
    mediaIndex: createMemoryMediaIndexPort(),
    fetchRaw: async () => []
  }),
  submissions: SubmissionPort = createMemorySubmissionPort()
): Services {
  const read = createReadService({
    data,
    git,
    knownBlockTags: registry.knownBlockTags
  })
  return {
    data,
    git,
    index,
    read,
    authoring: createAuthoringService({ data }),
    publish: createPublishService({ data, git }),
    bulk: createBulkService({ data, git, read, author: OWNER_AUTHOR }),
    mediaIndex,
    submissions
  }
}

/** Seed the sample drafts only when the store is completely empty (no drafts AND
 *  no Git head) — so a reload never re-seeds over real content. */
async function seedIfEmpty(services: Services): Promise<void> {
  const [drafts, head] = await Promise.all([
    services.data.listDrafts(),
    services.git.headSha()
  ])
  if (drafts.length === 0 && head === null) {
    for (const s of seedDrafts) await services.data.saveDraft(s)
  }
}

/** Assemble the services bundle around any DataPort/GitPort and seed-if-empty.
 *  Adapter-agnostic: the app passes the persistent (idb) adapters, tests pass the
 *  in-memory ones — the same shipped bootstrap logic either way. */
export async function bootstrapServices(
  data: DataPort,
  git: GitPort,
  index?: IndexPort,
  mediaIndex?: MediaIndexService,
  submissions?: SubmissionPort
): Promise<Services> {
  const services = servicesFor(data, git, index, mediaIndex, submissions)
  await seedIfEmpty(services)
  return services
}

/** The app's default services: seeded in-memory adapters (swapped for real
 *  persistence later without touching the UI). */
export function createServices(): Services {
  return servicesFor(createMemoryDataPort(seedDrafts), createMemoryGitPort())
}

const ServicesContext = createContext<Services | null>(null)

export function ServicesProvider({
  services,
  children
}: {
  services: Services
  children: ReactNode
}) {
  return (
    <ServicesContext.Provider value={services}>
      {children}
    </ServicesContext.Provider>
  )
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext)
  if (ctx === null)
    throw new Error('useServices must be used within a ServicesProvider')
  return ctx
}

/** Back-compat accessor for screens that only need the DataPort (ContentList). */
export function useData(): DataPort {
  return useServices().data
}

/** Back-compat provider: builds a services bundle around a given DataPort so the
 *  existing content-list/smoke tests (which inject a DataPort) keep working. */
export function DataProvider({
  adapter,
  children
}: {
  adapter: DataPort
  children: ReactNode
}) {
  const services = useMemo(
    () => servicesFor(adapter, createMemoryGitPort()),
    [adapter]
  )
  return <ServicesProvider services={services}>{children}</ServicesProvider>
}

/** The app's DataPort (in-memory, seeded). Kept for main.tsx back-compat. */
export function createAppDataPort(): DataPort {
  return createMemoryDataPort(seedDrafts)
}
