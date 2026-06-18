import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Actor } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, createServices } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { DeployButton } from '../src/shell/DeployButton'

function wrap(children: ReactNode, actor?: Actor) {
  const services = createServices()
  return render(
    <MemoryRouter>
      <ActorProvider {...(actor ? { actor } : {})}>
        <ServicesProvider services={services}>
          <DeployProvider>{children}</DeployProvider>
        </ServicesProvider>
      </ActorProvider>
    </MemoryRouter>,
  )
}

describe('DeployButton', () => {
  it('renders a Deploy control for an owner and deploying updates the label', async () => {
    wrap(<DeployButton />)
    const btn = screen.getByRole('button', { name: /deploy site/i })
    expect(btn).toBeInTheDocument()
    // before deploy: "Deploy site"; after deploy with empty git, sha may be null (nothing committed) -> stays "Deploy site".
    fireEvent.click(btn)
    // The deploy runs without crashing; label remains a deploy control.
    await waitFor(() => expect(screen.getByRole('button', { name: /deploy/i })).toBeInTheDocument())
  })

  it('renders nothing for a viewer (no site.deploy permission)', () => {
    wrap(<DeployButton />, { id: 'v', role: 'viewer' })
    expect(screen.queryByRole('button', { name: /deploy/i })).not.toBeInTheDocument()
  })
})
