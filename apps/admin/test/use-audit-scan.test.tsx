import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { IndexPort } from '@setu/core'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { useAudit } from '../src/health/useAudit'
import { loadCachedScan } from '../src/health/scan-cache'

// A published post with no title + an image without alt + an extra body H1 — one
// offender for every content check.
const messy = '---\ntitle: ""\n---\n\n# Body heading\n\n![](/media/x.png)\n'

function harness(indexPort: IndexPort) {
  const git = createMemoryGitPort([
    { path: 'content/post/en/messy.mdoc', content: messy }
  ])
  const services = servicesFor(createMemoryDataPort(), git, indexPort)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider services={services}>
      <DeployProvider>
        <IndexProvider>{children}</IndexProvider>
      </DeployProvider>
    </ServicesProvider>
  )
  return renderHook(() => useAudit(), { wrapper })
}

beforeEach(() => localStorage.clear())

describe('useAudit content scan (#593)', () => {
  it('does NOT scan on mount, and scan() fills the cache with index offenders', async () => {
    const port = createMemoryIndexPort()
    const summarySpy = vi.spyOn(port, 'auditSummary')
    const { result } = harness(port)

    // Mount computes the instant audit (config/platform) with NO content scan.
    await waitFor(() => expect(result.current.audit).not.toBeNull())
    expect(summarySpy).not.toHaveBeenCalled()
    expect(result.current.scannedAt).toBeNull()
    // Content checks read as pending until a scan runs.
    expect(
      result.current.audit!.results.find(
        (r) => r.id === 'foundations.entry-title'
      )?.status
    ).toBe('pending')

    // Wait for the browser index to finish building the seeded post before scanning.
    await waitFor(async () => {
      const q = await port.query({ collection: 'post', offset: 0, limit: 10 })
      expect(q.total).toBe(1)
    })

    // Explicit scan → reads the index summary, caches it, flips the content checks.
    await act(async () => {
      await result.current.scan()
    })
    expect(summarySpy).toHaveBeenCalledTimes(1)
    expect(result.current.scannedAt).not.toBeNull()

    const cached = loadCachedScan()
    expect(cached?.scan.titleOffenders).toEqual(['post/en/messy'])
    expect(cached?.scan.altOffenders).toEqual([
      { ref: 'post/en/messy', count: 1 }
    ])
    expect(cached?.scan.h1Offenders).toEqual(['post/en/messy'])

    await waitFor(() =>
      expect(
        result.current.audit!.results.find(
          (r) => r.id === 'foundations.entry-title'
        )?.status
      ).toBe('fail')
    )
  })
})
