import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort, type GitSeedFile } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { NotificationProvider } from '../src/ui/notify'
import { PermalinksSettings } from '../src/screens/settings/PermalinksSettings'

// Radix Select calls scrollIntoView when the dropdown opens — stub it for jsdom.
beforeAll(() => {
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.scrollIntoView
  ) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

afterEach(() => localStorage.clear())

function renderPermalinks(seed: GitSeedFile[] = []) {
  const git = createMemoryGitPort(seed)
  const services = servicesFor(createMemoryDataPort([]), git)
  const wrapper = (children: ReactNode) => (
    <NotificationProvider>
      <ActorProvider>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
  render(wrapper(<PermalinksSettings />))
  return { git }
}

describe('PermalinksSettings', () => {
  it('leaves an untouched "Plain" preset absent from the saved patterns map', async () => {
    const { git } = renderPermalinks()
    await screen.findByText(/category base/i)
    // Editing only the category base is enough to make the form dirty and savable.
    const base = screen.getByLabelText('Category base')
    fireEvent.change(base, { target: { value: 'misc' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      expect(raw).not.toBeNull()
      const permalinks = JSON.parse(raw as string).permalinks
      expect(permalinks.patterns).toEqual({})
      expect(permalinks.uncategorized).toBe('misc')
    })
  })

  it('offers every preset plus Custom… in the collection Select, without raw typing', async () => {
    renderPermalinks()
    await screen.findByText(/category base/i)
    const postPreset = screen.getAllByLabelText('Structure')[0]!
    postPreset.focus()
    fireEvent.keyDown(postPreset, { key: ' ', code: 'Space' })
    const listbox = await screen.findByRole('listbox')
    const optionTexts = within(listbox)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(optionTexts.some((t) => t?.includes('Plain'))).toBe(true)
    expect(optionTexts.some((t) => t?.includes('Post name'))).toBe(true)
    expect(optionTexts.some((t) => t?.includes('Day and name'))).toBe(true)
    expect(optionTexts.some((t) => t?.includes('Month and name'))).toBe(true)
    expect(optionTexts.some((t) => t?.includes('Category and name'))).toBe(true)
    expect(optionTexts).toContain('Custom…')
  })

  it('loads a stored custom pattern into the Custom… input with a live preview', async () => {
    renderPermalinks([
      {
        path: 'settings.json',
        content: JSON.stringify({
          permalinks: { patterns: { post: ':year/:category/:slug' } }
        })
      }
    ])
    const patternInput = await screen.findByLabelText('Custom pattern')
    expect(patternInput).toHaveValue(':year/:category/:slug')
    // Sample ref: slug my-first-post, 2026-03-09 UTC, category news.
    expect(
      screen.getByText('example.com/2026/news/my-first-post')
    ).toBeInTheDocument()
  })

  it('shows an inline error and disables Save for an invalid custom pattern', async () => {
    const { git } = renderPermalinks([
      {
        path: 'settings.json',
        content: JSON.stringify({
          permalinks: { patterns: { post: 'blog/:slug' } }
        })
      }
    ])
    const patternInput = await screen.findByLabelText('Custom pattern')
    fireEvent.change(patternInput, { target: { value: '/absolute/:slug' } })

    expect(await screen.findByText(/must be relative/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()

    // Fixing the pattern to a different valid one re-enables Save and it round-trips.
    fireEvent.change(patternInput, { target: { value: 'articles/:slug' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const raw = await git.readFile('settings.json')
      const permalinks = JSON.parse(raw as string).permalinks
      expect(permalinks.patterns.post).toBe('articles/:slug')
    })
  })

  it('rejects an invalid category base and disables Save', async () => {
    renderPermalinks()
    const base = await screen.findByLabelText('Category base')
    fireEvent.change(base, { target: { value: 'Not Valid!' } })
    expect(
      await screen.findByText(/lowercase letters, digits, or hyphens/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })
})
