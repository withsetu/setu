import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, createServices } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'

function renderEditor(path = '/edit/post/en/release-notes') {
  const services = createServices()
  render(
    <MemoryRouter initialEntries={[path]}>
      <ActorProvider>
        <ServicesProvider services={services}>
          <TaxonomyProvider>
            <DeployProvider>
              <IndexProvider>
                <Routes><Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} /></Routes>
              </IndexProvider>
            </DeployProvider>
          </TaxonomyProvider>
        </ServicesProvider>
      </ActorProvider>
    </MemoryRouter>,
  )
}

describe('EditorScreen publish', () => {
  it('shows a Publish button and publishing makes the status Staged', async () => {
    renderEditor()
    await screen.findByDisplayValue('Release notes')
    expect(screen.getByText('Draft', { selector: '.badge' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    await waitFor(() => expect(screen.getByText('Staged', { selector: '.badge' })).toBeInTheDocument())
  })

  it('gates "View page": disabled before publish, a live link after', async () => {
    renderEditor()
    await screen.findByDisplayValue('Release notes')
    // Draft → there is no live page yet: the control is a disabled button, not a link.
    expect(screen.queryByRole('link', { name: /view this page on the live site/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /not on the site yet/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /view this page on the live site/i })
      expect(link).toHaveAttribute('href', 'http://localhost:4321/post/release-notes')
      expect(link).toHaveAttribute('target', '_blank')
    })
  })
})
