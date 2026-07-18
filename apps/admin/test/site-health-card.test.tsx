import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { AuditResult, AuditScanData, GitPort } from '@setu/core'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import {
  SiteHealthCard,
  SiteHealthCardView
} from '../src/screens/dashboard/SiteHealthCard'

const audit: AuditResult = {
  results: [],
  score: 64,
  band: 'needs-work',
  byCategory: [],
  mustHaves: { done: 4, total: 7 }
}

const scanData: AuditScanData = {
  titleOffenders: [],
  altOffenders: [],
  h1Offenders: [],
  entryIds: ['post/en/a'],
  locales: ['en']
}

const seedCache = () =>
  localStorage.setItem(
    'setu.sitehealth.scan',
    JSON.stringify({ scannedAt: new Date().toISOString(), scan: scanData })
  )

function renderCard(git: GitPort = createMemoryGitPort()) {
  const services = servicesFor(
    createMemoryDataPort(),
    git,
    createMemoryIndexPort()
  )
  return render(
    <MemoryRouter>
      <ServicesProvider services={services}>
        <DeployProvider>
          <IndexProvider>
            <SiteHealthCard />
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    </MemoryRouter>
  )
}

beforeEach(() => localStorage.clear())

describe('SiteHealthCardView', () => {
  it('shows the score, band, must-have tally and last-scanned time', () => {
    render(
      <MemoryRouter>
        <SiteHealthCardView
          audit={audit}
          scannedAt={new Date().toISOString()}
        />
      </MemoryRouter>
    )
    expect(screen.getByText('64')).toBeTruthy()
    expect(screen.getByText(/needs work/i)).toBeTruthy()
    expect(screen.getByText(/4\s*\/\s*7/)).toBeTruthy()
    expect(screen.getByText(/scanned/i)).toBeTruthy()
  })
})

describe('SiteHealthCard (#593)', () => {
  it('renders the scored card from the cached scan (no live content scan)', async () => {
    seedCache()
    renderCard()
    // Once a scan is cached the card shows the scored view — a "Scanned <ago>" note
    // and the report link — computed from the cache + live instant checks, never a
    // fresh audit summary on mount (proven in use-audit-scan.test.tsx).
    await waitFor(() =>
      expect(screen.getByText(/scanned/i)).toBeInTheDocument()
    )
    expect(screen.getByText(/view report/i)).toBeInTheDocument()
    expect(screen.queryByText(/haven.t been scanned yet/i)).toBeNull()
  })

  it('shows a "not scanned yet" prompt (not a walk) when there is no cache', async () => {
    renderCard()
    await waitFor(() =>
      expect(screen.getByText(/haven.t been scanned yet/i)).toBeInTheDocument()
    )
    expect(screen.getByText(/open site health to scan/i)).toBeInTheDocument()
  })

  it('renders skeleton placeholders while the attestation state loads (#572)', () => {
    // A never-resolving readFile keeps the health load — and thus the audit — pending.
    const git: GitPort = {
      ...createMemoryGitPort(),
      readFile: () => new Promise<string | null>(() => {})
    }
    const { container } = renderCard(git)
    expect(screen.getByText('Site Health')).toBeInTheDocument()
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
  })
})
