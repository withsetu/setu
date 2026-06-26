import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { parseSettings } from '@setu/core'
import { useServices } from '../data/store'

interface SiteTitleApi {
  /** The configured site title (from settings.json), or 'Setu' until set/loaded. */
  title: string
  /** Re-read settings.json (call after the General settings form saves). */
  refresh: () => void
}

const SiteTitleContext = createContext<SiteTitleApi>({ title: 'Setu', refresh: () => {} })

/** Reads the site title from the Git-backed settings.json so the admin's document
 *  title can read "<Screen> - <Site Title> - Setu". Defaults to 'Setu'. */
export function SiteTitleProvider({ children }: { children: ReactNode }) {
  const { git } = useServices()
  const [title, setTitle] = useState('Setu')

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const raw = await git.readFile('settings.json')
        const t = parseSettings(raw ? (JSON.parse(raw) as unknown) : undefined).general.title
        setTitle(t || 'Setu')
      } catch {
        setTitle('Setu')
      }
    })()
  }, [git])

  useEffect(() => refresh(), [refresh])

  return <SiteTitleContext.Provider value={{ title, refresh }}>{children}</SiteTitleContext.Provider>
}

export const useSiteTitle = (): string => useContext(SiteTitleContext).title
export const useRefreshSiteTitle = (): (() => void) => useContext(SiteTitleContext).refresh
