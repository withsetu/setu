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
      // #956: `patterns` is no longer written when the admin did not touch it, so "absent from the
      // saved patterns map" is now literally absent rather than an empty object. Either spelling
      // means the same thing to `resolvePermalinkConfig` — no stored entry, inherit the default —
      // which is why the assertion accepts both rather than pinning the incidental one.
      expect(permalinks.patterns ?? {}).toEqual({})
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

  // #989. Every other custom-pattern test in this file enters custom mode by SEEDING a stored
  // non-preset pattern, which is the one door that worked — so the whole set passed while
  // selecting "Custom…" was inert for every collection. Custom mode used to be re-derived from
  // the pattern value on each render, and choosing Custom… wrote the current preset's pattern
  // back, which `presetForPattern` then matched to that preset again.
  it.each([
    ['from Plain (no stored pattern)', undefined],
    ['from a non-default preset', ':year/:month/:slug']
  ])(
    'reveals the Custom pattern input when Custom… is chosen %s',
    async (_label, stored) => {
      renderPermalinks(
        stored === undefined
          ? []
          : [
              {
                path: 'settings.json',
                content: JSON.stringify({
                  permalinks: { patterns: { post: stored } }
                })
              }
            ]
      )
      await screen.findByText(/category base/i)
      expect(screen.queryByLabelText('Custom pattern')).toBeNull()

      const postPreset = screen.getAllByLabelText('Structure')[0]!
      postPreset.focus()
      fireEvent.keyDown(postPreset, { key: ' ', code: 'Space' })
      const listbox = await screen.findByRole('listbox')
      fireEvent.click(within(listbox).getByRole('option', { name: 'Custom…' }))

      // Pre-filled with whatever was in effect, so the pattern does not jump under the user.
      const input = await screen.findByLabelText('Custom pattern')
      expect(input).toHaveValue(stored ?? ':collection/:slug')
    }
  )

  it('leaves custom mode when a preset is chosen again', async () => {
    renderPermalinks([
      {
        path: 'settings.json',
        content: JSON.stringify({
          permalinks: { patterns: { post: 'articles/:slug' } }
        })
      }
    ])
    expect(await screen.findByLabelText('Custom pattern')).toBeInTheDocument()

    const postPreset = screen.getAllByLabelText('Structure')[0]!
    postPreset.focus()
    fireEvent.keyDown(postPreset, { key: ' ', code: 'Space' })
    const listbox = await screen.findByRole('listbox')
    fireEvent.click(within(listbox).getByRole('option', { name: /Post name/ }))

    await waitFor(() =>
      expect(screen.queryByLabelText('Custom pattern')).toBeNull()
    )
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

  // #956, the worst case in the set: `salvagePatterns` DROPS a per-collection pattern that fails
  // validation, and the screen used to write that salvaged reading back as the whole group — so an
  // unrelated edit erased the stored pattern from Git under a "Settings saved" toast, and a
  // permalink pattern owns every published URL for its collection.
  it('leaves a stored pattern that failed validation byte-identical through an unrelated save', async () => {
    const stored = {
      permalinks: {
        // `post` fails validation (absolute) and is dropped at parse; `page` is a valid
        // non-default pattern, so it is the one the screen renders a Custom… input for.
        patterns: { post: '/absolute/:slug', page: 'pages/:slug' },
        uncategorized: 'category'
      }
    }
    const { git } = renderPermalinks([
      { path: 'settings.json', content: JSON.stringify(stored, null, 2) + '\n' }
    ])
    await screen.findByText(/category base/i)
    // (a) a different field entirely
    fireEvent.change(screen.getByLabelText('Category base'), {
      target: { value: 'misc' }
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const permalinks = JSON.parse(
        (await git.readFile('settings.json')) as string
      ).permalinks
      expect(permalinks.uncategorized).toBe('misc')
      expect(permalinks.patterns.post).toBe('/absolute/:slug')
    })
    // (b) a DIFFERENT COLLECTION's pattern — the per-entry half of the rule
    const custom = await screen.findByLabelText('Custom pattern')
    fireEvent.change(custom, { target: { value: 'docs/:slug' } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const permalinks = JSON.parse(
        (await git.readFile('settings.json')) as string
      ).permalinks
      expect(permalinks.patterns.page).toBe('docs/:slug')
      expect(permalinks.patterns.post).toBe('/absolute/:slug')
    })
  })

  // The same whole-group write listed the two known fields explicitly, so an unknown field a newer
  // build had stored inside the permalinks group was dropped too — and under the #956 patch a key
  // missing from the screen's own object reads as a deliberate DELETE, which is why the save now
  // spreads `values` instead of listing the fields.
  it('an unknown field inside the permalinks group survives a pattern edit', async () => {
    const stored = {
      permalinks: { patterns: { post: 'blog/:slug' }, futureField: { x: 1 } }
    }
    const { git } = renderPermalinks([
      { path: 'settings.json', content: JSON.stringify(stored, null, 2) + '\n' }
    ])
    const patternInput = await screen.findByLabelText('Custom pattern')
    fireEvent.change(patternInput, { target: { value: 'articles/:slug' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(async () => {
      const permalinks = JSON.parse(
        (await git.readFile('settings.json')) as string
      ).permalinks
      expect(permalinks.patterns.post).toBe('articles/:slug')
      expect(permalinks.futureField).toEqual({ x: 1 })
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
