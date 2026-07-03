import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { parseContentPath } from '@setu/core'
import { useServices } from '../data/store'

interface DeployState {
  /** repo-path -> the content that is "live" (snapshot at the last deploy). */
  snapshot: ReadonlyMap<string, string>
  /** the HEAD sha that was deployed, or null if never deployed. */
  sha: string | null
}

interface DeployApi {
  /** The live content at a repo path, or null if not deployed. */
  deployedAt(path: string): string | null
  /** The deployed HEAD sha (null if never deployed). */
  sha: string | null
  /** Snapshot the current Git working set as "live" (the SSG-shaped stand-in). */
  deploy(): Promise<void>
}

const DeployContext = createContext<DeployApi | null>(null)

export function DeployProvider({ children }: { children: ReactNode }) {
  const { git } = useServices()
  const [state, setState] = useState<DeployState>({
    snapshot: new Map(),
    sha: null
  })

  const deploy = useCallback(async () => {
    const paths = await git.list('content/')
    const next = new Map<string, string>()
    for (const path of paths) {
      if (parseContentPath(path) === null) continue
      const content = await git.readFile(path)
      if (content !== null) next.set(path, content)
    }
    const sha = await git.headSha()
    setState({ snapshot: next, sha })
  }, [git])

  const deployedAt = useCallback(
    (path: string) => state.snapshot.get(path) ?? null,
    [state]
  )

  return (
    <DeployContext.Provider value={{ deployedAt, sha: state.sha, deploy }}>
      {children}
    </DeployContext.Provider>
  )
}

export function useDeploy(): DeployApi {
  const ctx = useContext(DeployContext)
  if (ctx === null)
    throw new Error('useDeploy must be used within a DeployProvider')
  return ctx
}
