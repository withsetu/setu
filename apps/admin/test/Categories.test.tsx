import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { NotificationProvider } from '../src/ui/notify'
import { Categories } from '../src/screens/Categories'

function wrap() {
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  return render(
    <MemoryRouter>
      <ServicesProvider services={services}>
        <DeployProvider>
          <IndexProvider>
            <TaxonomyProvider>
              <NotificationProvider>
                <Categories />
              </NotificationProvider>
            </TaxonomyProvider>
          </IndexProvider>
        </DeployProvider>
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

  it('re-parents a category under another root category', async () => {
    wrap()
    // Create two root categories
    const newInput = screen.getByPlaceholderText('New category')
    fireEvent.change(newInput, { target: { value: 'Tutorials' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(screen.getByDisplayValue('Tutorials')).toBeTruthy())

    fireEvent.change(newInput, { target: { value: 'React' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(screen.getByDisplayValue('React')).toBeTruthy())

    // Re-parent "React" under "Tutorials"
    const parentSelect = screen.getByRole('combobox', { name: /parent of react/i })
    fireEvent.change(parentSelect, { target: { value: 'tutorials' } })

    // The "React" row should now be indented (depth 1 → paddingLeft 16px)
    await waitFor(() => {
      const reactInput = screen.getByDisplayValue('React')
      const row = reactInput.closest('li') as HTMLElement
      expect(row.style.paddingLeft).toBe('16px')
    })
  })
})
