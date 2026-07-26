import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort, type GitSeedFile } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { NotificationProvider } from '../src/ui/notify'
import { GeneralSettings } from '../src/screens/settings/GeneralSettings'

afterEach(() => localStorage.clear())

function renderGeneral(seed: GitSeedFile[] = []) {
  const git = createMemoryGitPort(seed)
  const services = servicesFor(createMemoryDataPort([]), git)
  const wrapper = (children: ReactNode) => (
    <NotificationProvider>
      <ActorProvider>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
  render(wrapper(<GeneralSettings />))
  return { git }
}

describe('GeneralSettings', () => {
  it('edits the title and commits settings.json with the merged general group', async () => {
    const { git } = renderGeneral()
    const title = await screen.findByLabelText(/site title/i)
    fireEvent.change(title, { target: { value: 'My Blog' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw as string).general.title).toBe('My Blog')
    })
  })

  // #956: the screen loaded `parseSettings(raw).general` — the SALVAGED reading, in which a
  // non-string field has already been replaced by its default — and wrote that reading back as the
  // whole group, so an unrelated title edit ERASED the stored value from Git under a "Settings
  // saved" toast. settings.json is Git-canonical, so this arrives by `git push`.
  it('a title save leaves a stored dateFormat the salvage layer rejected byte-identical', async () => {
    const stored = { general: { title: 'Old', dateFormat: 42 } }
    const { git } = renderGeneral([
      { path: 'settings.json', content: JSON.stringify(stored, null, 2) + '\n' }
    ])
    const title = await screen.findByLabelText(/site title/i)
    fireEvent.change(title, { target: { value: 'My Blog' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      const general = JSON.parse(raw as string).general
      expect(general.title).toBe('My Blog')
      expect(general.dateFormat).toBe(42)
    })
  })
})
