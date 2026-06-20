import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, createServices } from '../src/data/store'
import { DeployProvider, useDeploy } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'

function DeployTrigger() {
  const { deploy } = useDeploy()
  return <button onClick={() => void deploy()}>do-deploy</button>
}

describe('deploy status', () => {
  it('after publish + deploy, the editor status pill shows Live', async () => {
    const services = createServices()
    render(
      <MemoryRouter initialEntries={['/edit/post/en/release-notes']}>
        <ActorProvider>
          <ServicesProvider services={services}>
            <TaxonomyProvider>
              <DeployProvider>
                <IndexProvider>
                  <DeployTrigger />
                  <Routes><Route path="/edit/:collection/:locale/:slug" element={<EditorScreen />} /></Routes>
                </IndexProvider>
              </DeployProvider>
            </TaxonomyProvider>
          </ServicesProvider>
        </ActorProvider>
      </MemoryRouter>,
    )
    await screen.findByDisplayValue('Release notes')
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    await waitFor(() => expect(screen.getByText('Staged', { selector: '.badge' })).toBeInTheDocument())
    fireEvent.click(screen.getByText('do-deploy'))
    await waitFor(() => expect(screen.getByText('Live', { selector: '.badge' })).toBeInTheDocument())
  })
})
