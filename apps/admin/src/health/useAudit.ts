import { useEffect, useState } from 'react'
import { runAudit, SITE_CAPABILITIES, type AuditResult } from '@setu/core'
import { useServices } from '../data/store'
import { useSettings } from '../data/settings-store'
import { loadAuditEntries } from './audit-context'

/** Loads committed content + settings, runs the audit in-memory. No network, no build. */
export function useAudit(): { audit: AuditResult | null } {
  const { git } = useServices()
  const settings = useSettings()
  const [audit, setAudit] = useState<AuditResult | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const entries = await loadAuditEntries(git)
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
          health: { items: {}, sections: {} }, // stopgap; Task B wires the persisted health-state
        })
        if (live) setAudit(result)
      } catch {
        // Git unavailable (e.g. in test stubs) — leave audit null, card shows "Checking…"
      }
    })()
    return () => { live = false }
  }, [git, settings])
  return { audit }
}
