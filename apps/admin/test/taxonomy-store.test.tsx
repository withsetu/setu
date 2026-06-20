import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { servicesFor } from '../src/data/store'
import { ServicesProvider } from '../src/data/store'
import { TaxonomyProvider, useTaxonomy } from '../src/data/taxonomy-store'

function Probe() {
  const { categories, create } = useTaxonomy()
  return (
    <div>
      <button onClick={() => void create({ name: 'Tutorials', parent: null })}>add</button>
      <ul>{categories.map((c) => <li key={c.slug}>{c.slug}</li>)}</ul>
    </div>
  )
}

function wrap() {
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  return render(
    <ServicesProvider services={services}>
      <TaxonomyProvider>
        <Probe />
      </TaxonomyProvider>
    </ServicesProvider>,
  )
}

describe('TaxonomyProvider', () => {
  it('starts empty and adds a category on create', async () => {
    wrap()
    expect(screen.queryByText('tutorials')).toBeNull()
    screen.getByText('add').click()
    await waitFor(() => expect(screen.getByText('tutorials')).toBeTruthy())
  })
})
