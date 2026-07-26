import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { IndexService } from '@setu/core'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort, type GitSeedFile } from '@setu/git-memory'
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

function renderReading(index?: IndexService, seed: GitSeedFile[] = []) {
  const git = createMemoryGitPort(seed)
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

  // #956: `reading.feed.items: "many"` is dropped one level down by the nested salvage, and the
  // screen used to write the salvaged reading back as the whole group — so an unrelated toggle
  // erased it from Git under a "Settings saved" toast. The patch is per-field INSIDE the
  // sub-group, which is why enabling the feed does not take `items` with it either.
  it('leaves a rejected reading.feed.items byte-identical through both an unrelated save and a feed save', async () => {
    const stored = {
      reading: {
        searchEngineVisible: true,
        feed: { enabled: false, items: 'many' }
      }
    }
    const seed = [
      { path: 'settings.json', content: JSON.stringify(stored, null, 2) + '\n' }
    ]
    const { git } = renderReading(undefined, seed)
    // (a) an unrelated field on the same screen
    const visibility = await screen.findByLabelText(
      /discourage search engines/i
    )
    fireEvent.click(visibility)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const reading = JSON.parse(
        (await git.readFile('settings.json')) as string
      ).reading
      expect(reading.searchEngineVisible).toBe(false)
      expect(reading.feed).toEqual({ enabled: false, items: 'many' })
    })
    // (b) the SIBLING of the rejected field, inside the same sub-group
    fireEvent.click(screen.getByLabelText(/enable rss feed/i))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const reading = JSON.parse(
        (await git.readFile('settings.json')) as string
      ).reading
      expect(reading.feed).toEqual({ enabled: true, items: 'many' })
    })
  })

  // The same whole-group write also stamped DEFAULTS over two sub-groups this screen has no
  // control for at all, so an admin who had hand-edited either lost it on the next save.
  it('does not write markdown/relatedPosts defaults over a stored value it cannot edit', async () => {
    const stored = {
      reading: { markdown: { mode: 'pages' }, relatedPosts: { count: 7 } }
    }
    const { git } = renderReading(undefined, [
      { path: 'settings.json', content: JSON.stringify(stored, null, 2) + '\n' }
    ])
    const toggle = await screen.findByLabelText(/discourage search engines/i)
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const reading = JSON.parse(
        (await git.readFile('settings.json')) as string
      ).reading
      expect(reading.markdown).toEqual({ mode: 'pages' })
      expect(reading.relatedPosts).toEqual({ count: 7 })
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
