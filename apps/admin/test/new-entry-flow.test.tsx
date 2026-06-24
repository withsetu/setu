import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DataPort, DraftInput, GitPort, TiptapDoc } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { CommandRegistryProvider } from '../src/command/registry'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

function LocationProbe() {
  return <div data-testid="loc">{useLocation().pathname}</div>
}

function renderAt(path: string, data: DataPort, git: GitPort) {
  render(
    <TooltipProvider>
      <NotificationProvider>
        <MemoryRouter initialEntries={[path]}>
          <ActorProvider>
            <ServicesProvider services={servicesFor(data, git)}>
              <DeployProvider>
                <IndexProvider>
                  <TaxonomyProvider>
                    <CommandRegistryProvider>
                      <Routes>
                        <Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} />
                      </Routes>
                      <LocationProbe />
                    </CommandRegistryProvider>
                  </TaxonomyProvider>
                </IndexProvider>
              </DeployProvider>
            </ServicesProvider>
          </ActorProvider>
        </MemoryRouter>
      </NotificationProvider>
    </TooltipProvider>,
  )
}

describe('New-entry compose flow', () => {
  it('mints a title-derived slug on first save and replaces the URL (not "new")', async () => {
    const data = createMemoryDataPort([])
    const git = createMemoryGitPort([])
    renderAt('/edit/post/en/new', data, git)

    const titleInput = await screen.findByLabelText('Title')
    expect((titleInput as HTMLInputElement).value).toBe('') // compose: blank, not a "new" draft
    fireEvent.change(titleInput, { target: { value: 'Post Test' } })

    // autosave debounce (~800ms) → mint + save + redirect
    await waitFor(
      () => expect(screen.getByTestId('loc')).toHaveTextContent('/edit/post/en/post-test'),
      { timeout: 2500 },
    )
    expect(await data.getDraft({ collection: 'post', locale: 'en', slug: 'post-test' })).not.toBeNull()
    // nothing was ever persisted under the "new" sentinel
    expect(await data.getDraft({ collection: 'post', locale: 'en', slug: 'new' })).toBeNull()
  })

  it('opens a blank compose even when other drafts already exist (each New is distinct)', async () => {
    const seed: DraftInput[] = [
      { collection: 'post', locale: 'en', slug: 'post-test', content: doc('existing'), metadata: { title: 'Post Test' } },
    ]
    renderAt('/edit/post/en/new', createMemoryDataPort(seed), createMemoryGitPort([]))
    const titleInput = await screen.findByLabelText('Title')
    expect((titleInput as HTMLInputElement).value).toBe('')
  })

  it('bumps the slug when the title collides with an existing entry', async () => {
    const seed: DraftInput[] = [
      { collection: 'post', locale: 'en', slug: 'post-test', content: doc('existing'), metadata: { title: 'Post Test' } },
    ]
    const data = createMemoryDataPort(seed)
    renderAt('/edit/post/en/new', data, createMemoryGitPort([]))
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Post Test' } })
    await waitFor(
      () => expect(screen.getByTestId('loc')).toHaveTextContent('/edit/post/en/post-test-2'),
      { timeout: 2500 },
    )
  })
})
