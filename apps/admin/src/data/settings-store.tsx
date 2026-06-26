import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { parseSettings, DEFAULT_SETTINGS, type SiteSettings } from '@setu/core'
import { useServices } from './store'

interface SettingsApi {
  settings: SiteSettings
  refresh: () => void
}

const SettingsContext = createContext<SettingsApi>({ settings: DEFAULT_SETTINGS, refresh: () => {} })

/** Reads the Git-backed settings.json once so the admin can consume site settings
 *  (document title, list page size, future groups). Defaults until loaded. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { git } = useServices()
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS)

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const raw = await git.readFile('settings.json')
        setSettings(parseSettings(raw ? (JSON.parse(raw) as unknown) : undefined))
      } catch {
        setSettings(DEFAULT_SETTINGS)
      }
    })()
  }, [git])

  useEffect(() => refresh(), [refresh])

  return <SettingsContext.Provider value={{ settings, refresh }}>{children}</SettingsContext.Provider>
}

export const useSettings = (): SiteSettings => useContext(SettingsContext).settings
export const useRefreshSettings = (): (() => void) => useContext(SettingsContext).refresh

// Back-compat (the document-title API from PR #46), now derived from full settings.
export const useSiteTitle = (): string => useSettings().general.title
export const useRefreshSiteTitle = (): (() => void) => useRefreshSettings()
