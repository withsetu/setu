import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/app'
import { DataProvider, createAppDataPort } from '../src/data/store'
import { ActorProvider } from '../src/auth/actor'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider adapter={createAppDataPort()}>
        <ActorProvider>
          <DeployProvider>
            <IndexProvider>
              <TaxonomyProvider>
                <App />
              </TaxonomyProvider>
            </IndexProvider>
          </DeployProvider>
        </ActorProvider>
      </DataProvider>
    </MemoryRouter>,
  )
}

describe('App', () => {
  it('renders the shell without crashing', () => {
    renderApp('/posts')
    expect(screen.getByText('Setu')).toBeInTheDocument()
  })

  it('redirects / to /dashboard', async () => {
    renderApp('/')
    expect(await screen.findByText(/here's your site at a glance/)).toBeInTheDocument()
  })
})
