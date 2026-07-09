import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { contentPath, parseMdoc } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, createServices } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { CommandRegistryProvider } from '../src/command/registry'

// Radix DropdownMenu calls scrollIntoView when it opens — stub it for jsdom.
beforeAll(() => {
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.scrollIntoView
  ) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

describe('EditorScreen unpublish', () => {
  it('Unpublish commits published:false (reversible, content kept)', async () => {
    const services = createServices()
    render(
      <TooltipProvider>
        <NotificationProvider>
          <MemoryRouter initialEntries={['/edit/post/en/release-notes']}>
            <ActorProvider>
              <ServicesProvider services={services}>
                <DeployProvider>
                  <IndexProvider>
                    <TaxonomyProvider>
                      <CommandRegistryProvider>
                        <Routes>
                          <Route
                            path="/edit/:collection/:locale/:slug"
                            element={<EditorScreen />}
                          />
                        </Routes>
                      </CommandRegistryProvider>
                    </TaxonomyProvider>
                  </IndexProvider>
                </DeployProvider>
              </ServicesProvider>
            </ActorProvider>
          </MemoryRouter>
        </NotificationProvider>
      </TooltipProvider>
    )
    await screen.findByDisplayValue('Release notes')
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    await waitFor(() =>
      expect(
        screen.getByText('Staged', { selector: '[data-slot="badge"]' })
      ).toBeInTheDocument()
    )
    // Radix DropdownMenu opens on Enter keydown in jsdom (PointerEvent not available)
    fireEvent.keyDown(
      screen.getByRole('button', { name: /more publish actions/i }),
      { key: 'Enter' }
    )
    fireEvent.click(screen.getByRole('menuitem', { name: /unpublish/i }))
    await waitFor(async () => {
      const file = await services.git.readFile(
        contentPath({ collection: 'post', locale: 'en', slug: 'release-notes' })
      )
      expect(file).not.toBeNull()
      expect(parseMdoc(file as string).frontmatter['published']).toBe(false)
    })

    // Publish always means go-live: clicking the primary Publish button on the
    // unpublished entry clears published:false (no separate Re-publish item).
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    await waitFor(async () => {
      const file = await services.git.readFile(
        contentPath({ collection: 'post', locale: 'en', slug: 'release-notes' })
      )
      expect(file).not.toBeNull()
      expect(parseMdoc(file as string).frontmatter['published']).not.toBe(false)
    })
  })
})
