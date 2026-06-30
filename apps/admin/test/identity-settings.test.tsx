import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { NotificationProvider } from '../src/ui/notify'
import { IdentitySettings } from '../src/screens/settings/IdentitySettings'

afterEach(() => localStorage.clear())

function renderIdentity() {
  const git = createMemoryGitPort([])
  const services = servicesFor(createMemoryDataPort([]), git)
  const wrapper = (children: ReactNode) => (
    <NotificationProvider>
      <ActorProvider>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
  render(wrapper(<IdentitySettings />))
  return { git }
}

describe('IdentitySettings', () => {
  it('commits the identity group: name, @-stripped handle, clean sameAs', async () => {
    const { git } = renderIdentity()

    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Ada Lovelace' } })

    const twitter = screen.getByLabelText(/twitter/i)
    fireEvent.change(twitter, { target: { value: '@ada' } }) // leading @ stripped on input

    fireEvent.click(screen.getByRole('button', { name: /add profile/i }))
    fireEvent.change(screen.getByLabelText('Social profile 1'), {
      target: { value: 'https://github.com/ada' },
    })

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      const identity = JSON.parse(raw as string).identity
      expect(identity.name).toBe('Ada Lovelace')
      expect(identity.twitterHandle).toBe('ada')
      expect(identity.socialProfiles).toEqual(['https://github.com/ada'])
      // an untouched group default is preserved on the merged save
      expect(identity.titleSeparator).toBe('·')
    })
  })

  it('drops blank social rows on save', async () => {
    const { git } = renderIdentity()
    await screen.findByLabelText('Name')
    // add two rows, fill only the second
    fireEvent.click(screen.getByRole('button', { name: /add profile/i }))
    fireEvent.click(screen.getByRole('button', { name: /add profile/i }))
    fireEvent.change(screen.getByLabelText('Social profile 2'), {
      target: { value: 'https://mastodon.social/@ada' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      const identity = JSON.parse(raw as string).identity
      expect(identity.socialProfiles).toEqual(['https://mastodon.social/@ada'])
    })
  })
})
