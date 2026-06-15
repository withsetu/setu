import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, createServices } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { EditorScreen } from '../src/editor/EditorScreen'

function renderEditor(path = '/edit/post/en/release-notes') {
  const services = createServices()
  render(
    <MemoryRouter initialEntries={[path]}>
      <ActorProvider>
        <ServicesProvider services={services}>
          <DeployProvider>
            <Routes><Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} /></Routes>
          </DeployProvider>
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
})
