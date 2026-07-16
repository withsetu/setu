import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { IndexService } from '@setu/core'
import { createIndexService } from '@setu/core'
import { useServices } from './store'
import { useDeploy } from '../deploy/deploy'
import { createHttpIndexService } from './http-index-service'
import { apiFetch } from '../lib/api-fetch'

const IndexContext = createContext<IndexService | null>(null)

export function IndexProvider({ children }: { children: ReactNode }) {
  const { data, git, index, apiBase } = useServices()
  const deploy = useDeploy()

  // deployInfo already reads a ref inside the provider, but keep the indirection so a
  // provider re-render can never stale-close over an old function identity here.
  const deployInfoRef = useRef(deploy.deployInfo)
  deployInfoRef.current = deploy.deployInfo

  // apiBase set → the SERVER owns the index (#464 Increment B): read through
  // /api/index/*, demoting the IndexedDB port to a stale-while-offline cache
  // and overlaying this browser's local drafts (see http-index-service.ts).
  // No apiBase → the browser-built index, exactly as before.
  const service = useMemo(
    () =>
      apiBase !== undefined
        ? createHttpIndexService({
            apiBase,
            fetchImpl: apiFetch,
            data,
            git,
            index,
            deploy: () => deployInfoRef.current()
          })
        : createIndexService({
            data,
            git,
            index,
            deploy: () => deployInfoRef.current()
          }),
    [data, git, index, apiBase]
  )
  // Failures must be LOUD: a swallowed rebuild error leaves the index empty and every
  // listing shows "No posts yet" with zero diagnostics (bit us in CI on #429 — all git
  // reads returned 200, the list stayed empty, and nothing said why). The app still
  // works degraded (editor/publish don't need the index), so log, don't crash.
  // #483 found the #429 cause: a concurrent rebuild's clear() landing between another
  // build's populate and the first query — fixed by coalescing/serialization in
  // createIndexService.
  useEffect(() => {
    void service.ensureBuilt().catch((err: unknown) => {
      console.error(
        '[setu] content-index build failed — listings will be empty:',
        err
      )
    })
  }, [service])
  const deployedSha = deploy.status?.deployedSha ?? null
  useEffect(() => {
    if (deployedSha !== null)
      void service.reindexAfterDeploy().catch((err: unknown) => {
        console.error('[setu] content-index deploy resync failed:', err)
      })
  }, [deployedSha, service])
  return (
    <IndexContext.Provider value={service}>{children}</IndexContext.Provider>
  )
}

export function useIndex(): IndexService {
  const ctx = useContext(IndexContext)
  if (ctx === null)
    throw new Error('useIndex must be used within an IndexProvider')
  return ctx
}
