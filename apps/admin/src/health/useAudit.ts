import { useCallback, useEffect, useState } from 'react'
import {
  runAudit,
  mergeProbe,
  SITE_CAPABILITIES,
  type AuditResult,
  type HealthState,
  type ProbeReport,
  type ProbeResponse
} from '@setu/core'
import { useServices, OWNER_AUTHOR } from '../data/store'
import { useSettings } from '../data/settings-store'
import { apiFetch } from '../lib/api-fetch'
import { loadAuditEntries } from './audit-context'
import { loadHealthState, writeHealthRecord } from './health-state'

const apiBase = import.meta.env.VITE_SETU_API ?? ''

export type ProbeState =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'done'; probedAt: string }
  | { status: 'unavailable'; reason: string; detail?: string }

/** Human copy for each honest "couldn't probe" reason. */
export function probeUnavailableMessage(
  reason: string,
  detail?: string
): string {
  if (reason === 'no-url')
    return 'Set your site URL under Settings → Identity to run live checks.'
  if (reason === 'fetch-failed')
    return `Couldn't reach your site${detail ? ` (${detail})` : ''}. Is it deployed and public?`
  // safeFetch block reasons (private-address, scheme, timeout, …)
  return `Your site URL couldn't be probed safely (${reason}).`
}

export function useAudit(): {
  audit: AuditResult | null
  toggle: (
    kind: 'item' | 'section',
    id: string,
    state: 'attested' | 'na' | null
  ) => Promise<void>
  health: HealthState
  probe: () => Promise<void>
  probeState: ProbeState
} {
  const { git } = useServices()
  const settings = useSettings()
  const [base, setBase] = useState<AuditResult | null>(null)
  const [health, setHealth] = useState<HealthState>({ items: {}, sections: {} })
  const [refreshKey, setRefreshKey] = useState(0)
  const [report, setReport] = useState<ProbeReport | null>(null)
  const [probeState, setProbeState] = useState<ProbeState>({ status: 'idle' })

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [entries, loadedHealth] = await Promise.all([
          loadAuditEntries(git),
          loadHealthState(git)
        ])
        const result = runAudit({
          settings: {
            general: {
              title: settings.general.title,
              description: settings.general.description
            },
            reading: {
              homepage: settings.reading.homepage,
              searchEngineVisible: settings.reading.searchEngineVisible,
              feed: { enabled: settings.reading.feed.enabled }
            }
          },
          entries,
          capabilities: SITE_CAPABILITIES,
          health: loadedHealth
        })
        if (live) {
          setBase(result)
          setHealth(loadedHealth)
        }
      } catch {
        /* git unavailable in test stubs — leave audit null */
      }
    })()
    return () => {
      live = false
    }
  }, [git, settings, refreshKey])

  const toggle = useCallback(
    async (
      kind: 'item' | 'section',
      id: string,
      state: 'attested' | 'na' | null
    ) => {
      const record = state
        ? { state, at: new Date().toISOString(), by: OWNER_AUTHOR.name }
        : null
      await writeHealthRecord(git, kind, id, record)
      setRefreshKey((k) => k + 1)
    },
    [git]
  )

  const probe = useCallback(async () => {
    setProbeState({ status: 'probing' })
    try {
      const res = await apiFetch(`${apiBase}/api/sitehealth/probe`, {
        method: 'POST'
      })
      const data = (await res.json()) as ProbeResponse
      if (data.available) {
        setReport({ probedAt: data.probedAt, results: data.results })
        setProbeState({ status: 'done', probedAt: data.probedAt })
      } else {
        setProbeState({
          status: 'unavailable',
          reason: data.reason,
          detail: data.detail
        })
      }
    } catch {
      setProbeState({
        status: 'unavailable',
        reason: 'fetch-failed',
        detail: 'The probe request failed.'
      })
    }
  }, [])

  // Overlay the live-probe results onto the build-time audit so the screen renders one
  // merged, re-scored picture.
  const audit = base && report ? mergeProbe(base, report) : base

  return { audit, toggle, health, probe, probeState }
}
