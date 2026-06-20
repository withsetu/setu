import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { Categories } from '../src/screens/Categories'

function wrap() {
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  return render(
    <MemoryRouter>
      <ServicesProvider services={services}>
        <TaxonomyProvider>
          <Categories />
        </TaxonomyProvider>
      </ServicesProvider>
    </MemoryRouter>,
  )
}

describe('Categories screen', () => {
  it('shows the empty state', () => {
    wrap()
    expect(screen.getByText(/no categories yet/i)).toBeTruthy()
  })

  it('creates then renames a category label', async () => {
    wrap()
    fireEvent.change(screen.getByPlaceholderText('New category'), { target: { value: 'Tutorials' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(screen.getByDisplayValue('Tutorials')).toBeTruthy())
    const nameInput = screen.getByDisplayValue('Tutorials')
    fireEvent.change(nameInput, { target: { value: 'Guides' } })
    fireEvent.blur(nameInput)
    await waitFor(() => expect(screen.getByDisplayValue('Guides')).toBeTruthy())
  })
})
