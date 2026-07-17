import { describe, it, expect, beforeEach } from 'vitest'
import type { AuditScanData } from '@setu/core'
import { loadCachedScan, saveCachedScan } from '../src/health/scan-cache'

const scan: AuditScanData = {
  titleOffenders: [],
  altOffenders: [],
  h1Offenders: [],
  entryIds: ['post/en/a'],
  locales: ['en']
}

const KEY = 'setu.sitehealth.scan'

beforeEach(() => localStorage.clear())

describe('scan-cache', () => {
  it('round-trips a saved scan with an ISO timestamp', () => {
    const saved = saveCachedScan(scan)
    expect(Number.isNaN(Date.parse(saved.scannedAt))).toBe(false)
    const loaded = loadCachedScan()
    expect(loaded?.scan).toEqual(scan)
    expect(loaded?.scannedAt).toBe(saved.scannedAt)
  })

  it('returns null (never-scanned) when there is no cache', () => {
    expect(loadCachedScan()).toBeNull()
  })

  it('rejects a shape-valid but UNPARSEABLE scannedAt (avoids "NaNm ago")', () => {
    localStorage.setItem(KEY, JSON.stringify({ scannedAt: 'not-a-date', scan }))
    expect(loadCachedScan()).toBeNull()
  })

  it('rejects a payload missing the scan shape', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ scannedAt: new Date().toISOString(), scan: {} })
    )
    expect(loadCachedScan()).toBeNull()
  })

  it('tolerates malformed JSON', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadCachedScan()).toBeNull()
  })
})
