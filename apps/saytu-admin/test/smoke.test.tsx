import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/app'
import { DataProvider, createAppDataPort } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider adapter={createAppDataPort()}>
        <DeployProvider>
          <App />
        </DeployProvider>
      </DataProvider>
    </MemoryRouter>,
  )
}

describe('App', () => {
  it('renders the shell without crashing', () => {
    renderApp('/posts')
    expect(screen.getByText('Saytu')).toBeInTheDocument()
  })

  it('redirects / to /posts', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Posts' })).toBeInTheDocument()
  })
})
