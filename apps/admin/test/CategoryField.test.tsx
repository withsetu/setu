import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { CategoryField } from '../src/editor/CategoryField'

function setup(selected: string[] = []) {
  const onChange = vi.fn()
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  render(
    <ServicesProvider services={services}>
      <TaxonomyProvider>
        <CategoryField selected={selected} onChange={onChange} editable />
      </TaxonomyProvider>
    </ServicesProvider>,
  )
  return { onChange }
}

describe('CategoryField', () => {
  it('inline-creates a category and selects it', async () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByPlaceholderText('New category'), { target: { value: 'Tutorials' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(screen.getByLabelText('Tutorials')).toBeTruthy())
    expect(onChange).toHaveBeenCalledWith(['tutorials'])
    // error surface stays clean on success
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('toggles an existing category off when checked', async () => {
    // create first so it exists, then render selected
    const git = createMemoryGitPort()
    const services = servicesFor(createMemoryDataPort(), git)
    const onChange = vi.fn()
    const { rerender } = render(
      <ServicesProvider services={services}>
        <TaxonomyProvider>
          <CategoryField selected={[]} onChange={onChange} editable />
        </TaxonomyProvider>
      </ServicesProvider>,
    )
    fireEvent.change(screen.getByPlaceholderText('New category'), { target: { value: 'News' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(screen.getByLabelText('News')).toBeTruthy())
    onChange.mockClear()
    rerender(
      <ServicesProvider services={services}>
        <TaxonomyProvider>
          <CategoryField selected={['news']} onChange={onChange} editable />
        </TaxonomyProvider>
      </ServicesProvider>,
    )
    fireEvent.click(screen.getByLabelText('News'))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
