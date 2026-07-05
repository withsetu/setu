import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, createServices } from '../src/data/store'
import { DeployProvider, useDeploy } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { CommandRegistryProvider } from '../src/command/registry'

function DeployTrigger() {
  const { deploy } = useDeploy()
  return <button onClick={() => void deploy()}>do-deploy</button>
}

describe('deploy status', () => {
  it('after publish + deploy, the editor status pill shows Live', async () => {
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
                        <DeployTrigger />
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
    fireEvent.click(screen.getByText('do-deploy'))
    await waitFor(() =>
      expect(
        screen.getByText('Live', { selector: '[data-slot="badge"]' })
      ).toBeInTheDocument()
    )
  })
})
