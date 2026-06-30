import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { ReadingSettings } from '../src/screens/settings/ReadingSettings'

afterEach(() => localStorage.clear())

function renderReading() {
  const git = createMemoryGitPort([])
  const services = servicesFor(createMemoryDataPort([]), git)
  const wrapper = (children: ReactNode) => (
    <NotificationProvider>
      <ActorProvider>
        <ServicesProvider services={services}>
          <DeployProvider>
            <IndexProvider>{children}</IndexProvider>
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
})
