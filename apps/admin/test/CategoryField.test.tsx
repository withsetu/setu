import { describe, expect, it, vi, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryGitPort, type GitSeedFile } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { CategoryField } from '../src/editor/CategoryField'

// Radix Select calls scrollIntoView when the dropdown opens — stub it for jsdom.
beforeAll(() => {
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.scrollIntoView
  ) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

const seedWithTwo: GitSeedFile[] = [
  {
    path: 'taxonomy/categories.yaml',
    content:
      '- slug: engineering\n  name: Engineering\n  parent: null\n- slug: news\n  name: News\n  parent: null\n'
  }
]

function setup(selected: string[] = [], editable = true) {
  const onChange = vi.fn()
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  render(
    <ServicesProvider services={services}>
      <DeployProvider>
        <IndexProvider>
          <TaxonomyProvider>
            <CategoryField
              selected={selected}
              onChange={onChange}
              editable={editable}
            />
          </TaxonomyProvider>
        </IndexProvider>
      </DeployProvider>
    </ServicesProvider>
  )
  return { onChange }
}

function setupWithSeed(selected: string[] = [], editable = true) {
  const onChange = vi.fn()
  const services = servicesFor(
    createMemoryDataPort(),
    createMemoryGitPort(seedWithTwo)
  )
  render(
    <ServicesProvider services={services}>
      <DeployProvider>
        <IndexProvider>
          <TaxonomyProvider>
            <CategoryField
              selected={selected}
              onChange={onChange}
              editable={editable}
            />
          </TaxonomyProvider>
        </IndexProvider>
      </DeployProvider>
    </ServicesProvider>
  )
  return { onChange }
}

describe('CategoryField', () => {
  it('inline-creates a category and selects it', async () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByPlaceholderText('New category'), {
      target: { value: 'Tutorials' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Tutorials' })).toBeTruthy()
    )
    expect(onChange).toHaveBeenCalledWith(['tutorials'])
    // error surface stays clean on success
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('checking a category row calls onChange with the slug added', async () => {
    const { onChange } = setupWithSeed([])
    await screen.findByRole('checkbox', { name: 'Engineering' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Engineering' }))
    expect(onChange).toHaveBeenCalledWith(['engineering'])
  })

  it('unchecking a selected category calls onChange with the slug removed', async () => {
    const { onChange } = setupWithSeed(['engineering', 'news'])
    await screen.findByRole('checkbox', { name: 'Engineering' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Engineering' }))
    expect(onChange).toHaveBeenCalledWith(['news'])
  })

  it('filter input narrows visible rows', async () => {
    setupWithSeed()
    await screen.findByRole('checkbox', { name: 'Engineering' })
    expect(screen.getByRole('checkbox', { name: 'News' })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Filter categories'), {
      target: { value: 'eng' }
    })
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'News' })).toBeNull()
    )
    expect(screen.getByRole('checkbox', { name: 'Engineering' })).toBeTruthy()
  })

  it('editable=false disables checkboxes and create controls', async () => {
    setupWithSeed([], false)
    await screen.findByRole('checkbox', { name: 'Engineering' })
    expect(screen.getByRole('checkbox', { name: 'Engineering' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'News' })).toBeDisabled()
    expect(screen.getByPlaceholderText('New category')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    expect(screen.getByPlaceholderText('Filter categories')).toBeDisabled()
  })

  it('renders an assigned-but-unregistered category as a checked, flagged row', async () => {
    setupWithSeed(['engineering', 'recipes'])
    await screen.findByRole('checkbox', { name: 'Engineering' })
    const orphan = screen.getByRole('checkbox', { name: 'recipes' })
    expect(orphan).toBeChecked()
    expect(screen.getByText('Not in registry')).toBeTruthy()
  })

  it('unchecking an orphan removes it from the selection', async () => {
    const { onChange } = setupWithSeed(['engineering', 'recipes'])
    await screen.findByRole('checkbox', { name: 'recipes' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'recipes' }))
    expect(onChange).toHaveBeenCalledWith(['engineering'])
  })

  it('keeps an unchecked orphan row visible so the removal is reversible', async () => {
    const onChange = vi.fn()
    const services = servicesFor(
      createMemoryDataPort(),
      createMemoryGitPort(seedWithTwo)
    )
    const ui = (selected: string[]) => (
      <ServicesProvider services={services}>
        <DeployProvider>
          <IndexProvider>
            <TaxonomyProvider>
              <CategoryField selected={selected} onChange={onChange} editable />
            </TaxonomyProvider>
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    )
    const { rerender } = render(ui(['recipes']))
    await screen.findByRole('checkbox', { name: 'recipes' })
    // Simulate the parent applying the uncheck: orphan leaves the selection…
    rerender(ui([]))
    // …but its row stays, unchecked, so it can be re-checked.
    const orphan = screen.getByRole('checkbox', { name: 'recipes' })
    expect(orphan).not.toBeChecked()
    fireEvent.click(orphan)
    expect(onChange).toHaveBeenCalledWith(['recipes'])
  })

  it('does not flag registry rows as orphans', async () => {
    setupWithSeed(['engineering'])
    await screen.findByRole('checkbox', { name: 'Engineering' })
    expect(screen.queryByText('Not in registry')).toBeNull()
  })

  it('shows orphan rows instead of the empty state when the registry is empty', async () => {
    setup(['recipes'])
    const orphan = await screen.findByRole('checkbox', { name: 'recipes' })
    expect(orphan).toBeChecked()
    expect(screen.queryByText('No categories yet — add one below.')).toBeNull()
  })

  it('keeps the empty state when the registry is empty and nothing is selected', async () => {
    setup([])
    await screen.findByText('No categories yet — add one below.')
  })

  it('filter narrows orphan rows too', async () => {
    setupWithSeed(['recipes'])
    await screen.findByRole('checkbox', { name: 'recipes' })
    fireEvent.change(screen.getByPlaceholderText('Filter categories'), {
      target: { value: 'eng' }
    })
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'recipes' })).toBeNull()
    )
    expect(screen.getByRole('checkbox', { name: 'Engineering' })).toBeTruthy()
  })

  it('toggles an existing category off when checked', async () => {
    // create first so it exists, then render selected
    const git = createMemoryGitPort()
    const services = servicesFor(createMemoryDataPort(), git)
    const onChange = vi.fn()
    const { rerender } = render(
      <ServicesProvider services={services}>
        <DeployProvider>
          <IndexProvider>
            <TaxonomyProvider>
              <CategoryField selected={[]} onChange={onChange} editable />
            </TaxonomyProvider>
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    )
    fireEvent.change(screen.getByPlaceholderText('New category'), {
      target: { value: 'News' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'News' })).toBeTruthy()
    )
    onChange.mockClear()
    rerender(
      <ServicesProvider services={services}>
        <DeployProvider>
          <IndexProvider>
            <TaxonomyProvider>
              <CategoryField selected={['news']} onChange={onChange} editable />
            </TaxonomyProvider>
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'News' }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
