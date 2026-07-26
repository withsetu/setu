import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { parseSettings } from '@setu/core'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort, type GitSeedFile } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { NotificationProvider } from '../src/ui/notify'
import { IdentitySettings } from '../src/screens/settings/IdentitySettings'

afterEach(() => localStorage.clear())

function renderIdentity(seed: GitSeedFile[] = []) {
  const git = createMemoryGitPort(seed)
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
      target: { value: 'https://github.com/ada' }
    })

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      const identity = JSON.parse(raw as string).identity
      expect(identity.name).toBe('Ada Lovelace')
      expect(identity.twitterHandle).toBe('ada')
      expect(identity.socialProfiles).toEqual(['https://github.com/ada'])
      // #956: an untouched field is no longer WRITTEN at all — the save patches the stored group
      // with what changed instead of stamping the whole salvaged reading over it — and absence is
      // how "use the default" is stored, so the effective value is unchanged. Asserting through
      // parseSettings is the honest form of the old "an untouched group default is preserved"
      // claim: it checks what the site reads, not what the file happens to spell out.
      expect(identity.titleSeparator).toBeUndefined()
      expect(
        parseSettings(JSON.parse(raw as string)).identity.titleSeparator
      ).toBe('·')
    })
  })

  // #956: `entityType: "robot"` is coerced to the default at parse and a non-string member of
  // `socialProfiles` is filtered out, and the screen used to write that salvaged reading back as
  // the whole group — so an unrelated name edit erased both from Git under a "Settings saved"
  // toast. settings.json is Git-canonical: these arrive by `git push`.
  it('a name save leaves a rejected entityType and a filtered socialProfiles byte-identical', async () => {
    const stored = {
      identity: {
        name: 'Old',
        entityType: 'robot',
        socialProfiles: ['https://a.example', 42]
      }
    }
    const { git } = renderIdentity([
      { path: 'settings.json', content: JSON.stringify(stored, null, 2) + '\n' }
    ])
    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Ada Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const identity = JSON.parse(
        (await git.readFile('settings.json')) as string
      ).identity
      expect(identity.name).toBe('Ada Lovelace')
      expect(identity.entityType).toBe('robot')
      expect(identity.socialProfiles).toEqual(['https://a.example', 42])
    })
  })

  it('drops blank social rows on save', async () => {
    const { git } = renderIdentity()
    await screen.findByLabelText('Name')
    // add two rows, fill only the second
    fireEvent.click(screen.getByRole('button', { name: /add profile/i }))
    fireEvent.click(screen.getByRole('button', { name: /add profile/i }))
    fireEvent.change(screen.getByLabelText('Social profile 2'), {
      target: { value: 'https://mastodon.social/@ada' }
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      const identity = JSON.parse(raw as string).identity
      expect(identity.socialProfiles).toEqual(['https://mastodon.social/@ada'])
    })
  })
})
