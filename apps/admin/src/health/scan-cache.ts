import type { AuditScanData } from '@setu/core'

/** The last Site Health content scan, cached on THIS machine (#593). The scan is
 *  derived, on-demand data (like Yoast/Screaming Frog's crawl) — not content — so
 *  it lives in localStorage, never Git. The dashboard card and the Site Health
 *  screen read it so neither triggers a per-entry content walk on load. */
export interface CachedScan {
  /** ISO timestamp the scan was run. */
  scannedAt: string
  scan: AuditScanData
}

const KEY = 'setu.sitehealth.scan'

export function loadCachedScan(): CachedScan | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as CachedScan
    // Shape-guard: a partial/older payload is treated as "never scanned".
    if (
      typeof parsed?.scannedAt !== 'string' ||
      !Array.isArray(parsed?.scan?.entryIds)
    )
      return null
    return parsed
  } catch {
    return null
  }
}

export function saveCachedScan(scan: AuditScanData): CachedScan {
  const cached: CachedScan = { scannedAt: new Date().toISOString(), scan }
  try {
    localStorage.setItem(KEY, JSON.stringify(cached))
  } catch {
    /* private-mode / quota — the in-memory state still updates for this session */
  }
  return cached
}
