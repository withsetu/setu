import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { GitPort } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { NotificationProvider } from '../src/ui/notify'
import { GeneralSettings } from '../src/screens/settings/GeneralSettings'
import { ReadingSettings } from '../src/screens/settings/ReadingSettings'
import { IdentitySettings } from '../src/screens/settings/IdentitySettings'
import { PermalinksSettings } from '../src/screens/settings/PermalinksSettings'
import { MediaSettings } from '../src/screens/settings/MediaSettings'
import { Appearance } from '../src/screens/Appearance'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

/** A GitPort whose readFile rejects until `heal()` is called — the shape an unreachable api or a
 *  broken repo read produces. Every other method delegates to a real in-memory port. */
function brokenGit(): { git: GitPort; heal: () => void } {
  const inner = createMemoryGitPort([])
  let healthy = false
  const git: GitPort = {
    ...inner,
    readFile: (path: string) =>
      healthy
        ? inner.readFile(path)
        : Promise.reject(new Error('git read failed'))
  }
  return {
    git,
    heal: () => {
      healthy = true
    }
  }
}

function renderScreen(git: GitPort, node: ReactNode) {
  const services = servicesFor(createMemoryDataPort([]), git)
  // DeployProvider + IndexProvider are only needed by ReadingSettings (its page-picker effect
  // reads the index); harmless for the others. The empty memory git means the index build
  // touches no files, so brokenGit's rejecting readFile never fires from it.
  render(
    <NotificationProvider>
      <ActorProvider>
        <ServicesProvider services={services}>
          <DeployProvider>
            <IndexProvider>{node}</IndexProvider>
          </DeployProvider>
        </ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
}

describe('settings screens: a failed baseline read', () => {
  it('GeneralSettings shows a retryable error, NOT a disabled "Saved" button, when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { git, heal } = brokenGit()
    renderScreen(git, <GeneralSettings />)

    // The error is announced in place …
    const retry = await screen.findByRole('button', { name: /try again/i })
    // … and the "Saved" lie is NOT on screen (the whole point of #837) …
    expect(
      screen.queryByRole('button', { name: /^saved$/i })
    ).not.toBeInTheDocument()
    // … nor is the editable form (which would show default values it never read).
    expect(screen.queryByLabelText(/site title/i)).not.toBeInTheDocument()

    // Retry recovers into the real form.
    heal()
    fireEvent.click(retry)
    await waitFor(() =>
      expect(screen.getByLabelText(/site title/i)).toBeInTheDocument()
    )
    expect(
      screen.queryByRole('button', { name: /try again/i })
    ).not.toBeInTheDocument()
  })

  it.each([
    ['ReadingSettings', <ReadingSettings key="r" />],
    ['IdentitySettings', <IdentitySettings key="i" />],
    ['PermalinksSettings', <PermalinksSettings key="p" />],
    ['MediaSettings', <MediaSettings key="m" />]
  ])(
    '%s shows a retryable error instead of "Saved" on a failed read',
    async (_name, node) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { git } = brokenGit()
      renderScreen(git, node)

      expect(
        await screen.findByRole('button', { name: /try again/i })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /^saved$/i })
      ).not.toBeInTheDocument()
    }
  )

  it('Appearance shows a retryable error instead of a disabled "Published" button on a failed read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { git } = brokenGit()
    renderScreen(git, <Appearance />)

    expect(
      await screen.findByRole('button', { name: /try again/i })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^published$/i })
    ).not.toBeInTheDocument()
  })
})
