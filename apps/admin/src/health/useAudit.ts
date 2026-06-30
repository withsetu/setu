import { useCallback, useEffect, useState } from 'react'
import { runAudit, SITE_CAPABILITIES, type AuditResult, type HealthState } from '@setu/core'
import { useServices, OWNER_AUTHOR } from '../data/store'
import { useSettings } from '../data/settings-store'
import { loadAuditEntries } from './audit-context'
import { loadHealthState, writeHealthRecord } from './health-state'

export function useAudit(): {
  audit: AuditResult | null
  toggle: (kind: 'item' | 'section', id: string, state: 'attested' | 'na' | null) => Promise<void>
  health: HealthState
} {
  const { git } = useServices()
  const settings = useSettings()
  const [audit, setAudit] = useState<AuditResult | null>(null)
  const [health, setHealth] = useState<HealthState>({ items: {}, sections: {} })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [entries, loadedHealth] = await Promise.all([loadAuditEntries(git), loadHealthState(git)])
        const result = runAudit({
          settings: {
            general: { title: settings.general.title, description: settings.general.description },
            reading: {
              homepage: settings.reading.homepage,
              searchEngineVisible: settings.reading.searchEngineVisible,
              feed: { enabled: settings.reading.feed.enabled },
            },
          },
          entries,
          capabilities: SITE_CAPABILITIES,
          health: loadedHealth,
        })
        if (live) {
          setAudit(result)
          setHealth(loadedHealth)
        }
      } catch {
        /* git unavailable in test stubs — leave audit null */
      }
    })()
    return () => { live = false }
  }, [git, settings, refreshKey])

  const toggle = useCallback(async (kind: 'item' | 'section', id: string, state: 'attested' | 'na' | null) => {
    const record = state ? { state, at: new Date().toISOString(), by: OWNER_AUTHOR.name } : null
    await writeHealthRecord(git, kind, id, record)
    setRefreshKey((k) => k + 1)
  }, [git])

  return { audit, toggle, health }
}
