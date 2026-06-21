import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { MediaIndexService } from '@setu/core'
import { useServices } from './store'

const Ctx = createContext<MediaIndexService | null>(null)

export function MediaIndexProvider({ service, children }: { service: MediaIndexService; children: ReactNode }) {
  return <Ctx.Provider value={service}>{children}</Ctx.Provider>
}

export function useMediaIndex(): MediaIndexService {
  const v = useContext(Ctx)
  if (v === null) throw new Error('useMediaIndex must be used within a MediaIndexProvider')
  return v
}

export function AppMediaIndexProvider({ children }: { children: ReactNode }) {
  const { mediaIndex } = useServices()
  return <MediaIndexProvider service={mediaIndex}>{children}</MediaIndexProvider>
}
