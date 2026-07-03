import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryGitPort, type GitSeedFile } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { CategoryField } from '../src/editor/CategoryField'

const seed: GitSeedFile[] = [
  {
    path: 'taxonomy/categories.yaml',
    content:
      '- slug: tutorials\n  name: Tutorials\n  parent: null\n- slug: news\n  name: News\n  parent: null\n'
  }
]

function setup() {
  const services = servicesFor(
    createMemoryDataPort(),
    createMemoryGitPort(seed)
  )
  render(
    <ServicesProvider services={services}>
      <DeployProvider>
        <IndexProvider>
          <TaxonomyProvider>
            <CategoryField selected={[]} onChange={() => {}} editable />
          </TaxonomyProvider>
        </IndexProvider>
      </DeployProvider>
    </ServicesProvider>
  )
}

describe('CategoryField filter', () => {
  it('narrows the visible categories as you type', async () => {
    setup()
    // Wait for categories to load — find the Tutorials checkbox label
    await screen.findByLabelText('Tutorials')
    expect(screen.getByLabelText('News')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter categories'), {
      target: { value: 'tut' }
    })
    // News checkbox row should disappear; Tutorials checkbox row should remain
    await waitFor(() => expect(screen.queryByLabelText('News')).toBeNull())
    expect(screen.getByLabelText('Tutorials')).toBeTruthy()
  })
})
