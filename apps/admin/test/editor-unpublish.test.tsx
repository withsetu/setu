import { describe, it, expect } from 'vitest'
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

describe('EditorScreen unpublish', () => {
  it('Unpublish commits published:false (reversible, content kept)', async () => {
    const services = createServices()
    render(
      <NotificationProvider>
        <MemoryRouter initialEntries={['/edit/post/en/release-notes']}>
          <ActorProvider><ServicesProvider services={services}><DeployProvider><IndexProvider><TaxonomyProvider>
            <Routes><Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} /></Routes>
          </TaxonomyProvider></IndexProvider></DeployProvider></ServicesProvider></ActorProvider>
        </MemoryRouter>
      </NotificationProvider>,
    )
    await screen.findByDisplayValue('Release notes')
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    await waitFor(() => expect(screen.getByText('Staged', { selector: '[data-slot="badge"]' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /more publish actions/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /unpublish/i }))
    await waitFor(async () => {
      const file = await services.git.readFile(contentPath({ collection: 'post', locale: 'en', slug: 'release-notes' }))
      expect(file).not.toBeNull()
      expect(parseMdoc(file as string).frontmatter['published']).toBe(false)
    })

    // Re-publish: flag-based menu now shows Re-publish; committing clears published:false.
    fireEvent.click(screen.getByRole('button', { name: /more publish actions/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /re-publish/i }))
    await waitFor(async () => {
      const file = await services.git.readFile(contentPath({ collection: 'post', locale: 'en', slug: 'release-notes' }))
      expect(file).not.toBeNull()
      expect(parseMdoc(file as string).frontmatter['published']).not.toBe(false)
    })
  })
})
