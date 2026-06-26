import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { NotificationProvider } from '../src/ui/notify'
import { GeneralSettings } from '../src/screens/settings/GeneralSettings'

afterEach(() => localStorage.clear())

function renderGeneral() {
  const git = createMemoryGitPort([])
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
})
