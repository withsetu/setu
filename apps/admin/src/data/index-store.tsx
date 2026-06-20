import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { IndexService } from '@setu/core'
import { createIndexService } from '@setu/core'
import { createMemoryIndexPort } from '@setu/db-memory'
import { useServices } from './store'
import { useDeploy } from '../deploy/deploy'

const IndexContext = createContext<IndexService | null>(null)

export function IndexProvider({ children }: { children: ReactNode }) {
  const { data, git } = useServices()
  const deploy = useDeploy()
  const service = useMemo(
    () => createIndexService({ data, git, index: createMemoryIndexPort(), deployedAt: deploy.deployedAt }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, git, deploy.deployedAt],
  )
  useEffect(() => {
    void service.ensureBuilt().catch(() => {})
  }, [service])
  useEffect(() => {
    if (deploy.sha !== null) void service.reindexAfterDeploy().catch(() => {})
  }, [deploy.sha, service])
  return <IndexContext.Provider value={service}>{children}</IndexContext.Provider>
}

export function useIndex(): IndexService {
  const ctx = useContext(IndexContext)
  if (ctx === null) throw new Error('useIndex must be used within an IndexProvider')
  return ctx
}
