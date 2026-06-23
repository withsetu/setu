import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

// Radix Select calls scrollIntoView when the dropdown opens — stub it for jsdom.
beforeAll(() => {
  if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

import { MemoryRouter } from 'react-router-dom'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createIndexService } from '@setu/core'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TagsProvider } from '../src/data/tags-store'
import { NotificationProvider } from '../src/ui/notify'
import { TagsTab } from '../src/screens/taxonomies/TagsTab'

vi.mock('../src/deploy/deploy', async (orig) => ({
  ...(await orig() as object),
  useDeploy: () => ({ deployedAt: () => null, sha: null, deploy: () => Promise.resolve() }),
}))

type TiptapDoc = { type: 'doc'; content: Array<{ type: string; content?: Array<{ type: string; text: string }> }> }
const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

/** Build a wrapper with seeded entries so tagCounts returns { react: 2, css: 1 }. */
async function makeWrapper() {
  const data = createMemoryDataPort([
    { collection: 'post', locale: 'en', slug: 'a', content: doc('a') as any, metadata: { title: 'A', tags: ['react', 'css'] } },
    { collection: 'post', locale: 'en', slug: 'b', content: doc('b') as any, metadata: { title: 'B', tags: ['react'] } },
  ])
  const git = createMemoryGitPort()
  const indexPort = createMemoryIndexPort()

  // Build the index so tagCounts works
  const idx = createIndexService({ data, git, index: indexPort, deployedAt: () => null })
  await idx.rebuild()

  const services = servicesFor(data, git, indexPort)

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <ServicesProvider services={services}>
          <DeployProvider>
            <IndexProvider>
              <TagsProvider>
                <NotificationProvider>
                  {children}
                </NotificationProvider>
              </TagsProvider>
            </IndexProvider>
          </DeployProvider>
        </ServicesProvider>
      </MemoryRouter>
    )
  }

  return Wrapper
}

describe('TagsTab', () => {
  it('renders tags with counts, sorted most-used first (react before css)', async () => {
    const Wrapper = await makeWrapper()
    render(<TagsTab />, { wrapper: Wrapper })

    // Wait for both tags to appear
    const reactInput = await screen.findByDisplayValue('react')
    expect(reactInput).toBeInTheDocument()
    const cssInput = await screen.findByDisplayValue('css')
    expect(cssInput).toBeInTheDocument()

    // Verify "2 entries" and "1 entry" text
    expect(screen.getByText('2 entries')).toBeInTheDocument()
    expect(screen.getByText('1 entry')).toBeInTheDocument()

    // react should appear before css (most-used first)
    const inputs = screen.getAllByRole('textbox')
    const tagInputs = inputs.filter((i) => i.getAttribute('aria-label')?.startsWith('Rename'))
    const names = tagInputs.map((i) => (i as HTMLInputElement).value)
    expect(names.indexOf('react')).toBeLessThan(names.indexOf('css'))
  })

  it('search filters to matching tags only', async () => {
    const Wrapper = await makeWrapper()
    render(<TagsTab />, { wrapper: Wrapper })

    // Wait for both tags
    await screen.findByDisplayValue('react')

    // Type in search box
    const searchInput = screen.getByPlaceholderText('Search tags')
    fireEvent.change(searchInput, { target: { value: 'cs' } })

    // Only css should remain
    expect(screen.getByDisplayValue('css')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('react')).not.toBeInTheDocument()
  })

  it('inline-rename to a NEW name calls rename (no merge dialog), shows toast', async () => {
    const Wrapper = await makeWrapper()
    render(<TagsTab />, { wrapper: Wrapper })

    // Wait for css input
    const cssInput = (await screen.findByDisplayValue('css')) as HTMLInputElement

    // Change value and blur to trigger rename
    fireEvent.change(cssInput, { target: { value: 'styles' } })
    fireEvent.blur(cssInput)

    // Should show success toast (no merge dialog)
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    // Should show success toast with renamed message
    await waitFor(() => {
      expect(screen.getByText(/Renamed "css" → "styles"/i)).toBeInTheDocument()
    })
  })

  it('inline-rename to an existing tag opens merge dialog; confirming calls rename', async () => {
    const Wrapper = await makeWrapper()
    render(<TagsTab />, { wrapper: Wrapper })

    // Wait for css input
    const cssInput = (await screen.findByDisplayValue('css')) as HTMLInputElement

    // Rename css → react (which already exists)
    fireEvent.change(cssInput, { target: { value: 'react' } })
    fireEvent.blur(cssInput)

    // Merge dialog should open
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(/merge into "react"/i)).toBeInTheDocument()

    // Confirm the merge
    const mergeBtn = screen.getByRole('button', { name: /merge/i })
    fireEvent.click(mergeBtn)

    // Dialog should close and toast should appear
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText(/merged "css" into "react"/i)).toBeInTheDocument()
    })
  })

  it('delete opens delete dialog; confirming calls remove', async () => {
    const Wrapper = await makeWrapper()
    render(<TagsTab />, { wrapper: Wrapper })

    // Wait for css row
    await screen.findByDisplayValue('css')

    // Click delete button for css
    const deleteBtn = screen.getByRole('button', { name: /delete css/i })
    fireEvent.click(deleteBtn)

    // Delete dialog should open
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(/delete "css"/i)).toBeInTheDocument()
    expect(screen.getByText(/Used by 1 entry/i)).toBeInTheDocument()

    // Confirm delete
    const confirmBtn = screen.getByRole('button', { name: /^delete$/i })
    fireEvent.click(confirmBtn)

    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    // css should be gone from the list
    await waitFor(() => {
      expect(screen.queryByDisplayValue('css')).not.toBeInTheDocument()
    })
  })

  it('shows empty state when there are no tags', async () => {
    // Use an empty data port — no entries, no tags
    const data = createMemoryDataPort([])
    const git = createMemoryGitPort()
    const indexPort = createMemoryIndexPort()
    const idx = createIndexService({ data, git, index: indexPort, deployedAt: () => null })
    await idx.rebuild()
    const services = servicesFor(data, git, indexPort)

    render(
      <MemoryRouter>
        <ServicesProvider services={services}>
          <DeployProvider>
            <IndexProvider>
              <TagsProvider>
                <NotificationProvider>
                  <TagsTab />
                </NotificationProvider>
              </TagsProvider>
            </IndexProvider>
          </DeployProvider>
        </ServicesProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Tags appear here as you add them to content/i)).toBeInTheDocument()
  })
})
