import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { IndexService } from '@setu/core'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { ReadingSettings } from '../src/screens/settings/ReadingSettings'

afterEach(() => localStorage.clear())

/** A whole IndexService whose reads all resolve empty, so a single override
 *  isolates the one call under test. */
function stubIndex(overrides: Partial<IndexService> = {}): IndexService {
  return {
    rebuild: vi.fn(async () => {}),
    ensureBuilt: vi.fn(async () => {}),
    reindexEntry: vi.fn(async () => {}),
    reindexEntries: vi.fn(async () => {}),
    reindexAfterDeploy: vi.fn(async () => {}),
    markSyncedAt: vi.fn(async () => {}),
    query: vi.fn(async () => ({ rows: [], total: 0 })),
    stats: vi.fn(async () => ({})),
    distinctTags: vi.fn(async () => []),
    distinctLocales: vi.fn(async () => []),
    categoryCounts: vi.fn(async () => ({})),
    tagCounts: vi.fn(async () => ({})),
    referencedBy: vi.fn(async () => []),
    entriesByCategory: vi.fn(async () => []),
    entriesByTag: vi.fn(async () => []),
    auditSummary: vi.fn(async () => ({
      titleOffenders: [],
      altOffenders: [],
      h1Offenders: [],
      entryIds: [],
      locales: []
    })),
    ...overrides
  }
}

function renderReading(index?: IndexService) {
  const git = createMemoryGitPort([])
  const services = servicesFor(createMemoryDataPort([]), git)
  const wrapper = (children: ReactNode) => (
    <NotificationProvider>
      <ActorProvider>
        <ServicesProvider services={services}>
          <DeployProvider>
            <IndexProvider service={index}>{children}</IndexProvider>
          </DeployProvider>
        </ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
  render(wrapper(<ReadingSettings />))
  return { git }
}

describe('ReadingSettings', () => {
  it('toggles search-engine visibility and commits the reading group', async () => {
    const { git } = renderReading()
    const toggle = await screen.findByLabelText(/discourage search engines/i)
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw as string).reading.searchEngineVisible).toBe(false)
    })
  })

  it('enables the RSS feed and commits reading.feed', async () => {
    const { git } = renderReading()
    const toggle = await screen.findByLabelText(/enable rss feed/i)
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw as string).reading.feed.enabled).toBe(true)
    })
  })

  // #871: the pages-load effect (which fills the Homepage picker) had no catch, so a
  // rejecting index.query vanished into the global unhandled-rejection net — the user
  // got a generic toast at best, and nothing said WHICH control was missing options.
  it('reports a failed pages load, and leaves the rest of the form usable', async () => {
    renderReading(
      stubIndex({
        query: vi.fn(() => Promise.reject(new Error('index unavailable')))
      })
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/pages/i)
    // Not the raw rejection — a curated, action-naming message.
    expect(alert).not.toHaveTextContent('index unavailable')

    // Scoped fallback, not a full-screen load error: the rest of the form is still here
    // and still saveable, and the Homepage picker itself still renders.
    expect(screen.getByLabelText('Homepage')).toBeInTheDocument()
    expect(
      await screen.findByLabelText(/discourage search engines/i)
    ).toBeInTheDocument()
  })

  it('excludes a sitemap section (Tag archives) → commits reading.sitemap.tags=false', async () => {
    const { git } = renderReading()
    const toggle = await screen.findByLabelText('Tag archives')
    fireEvent.click(toggle) // default on → off
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(JSON.parse(raw as string).reading.sitemap.tags).toBe(false)
    })
  })
})
