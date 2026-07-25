import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort, createMemoryIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { serializeCategories } from '@setu/core'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { CategoryPicker } from '../src/ui/CategoryPicker'

vi.mock('../src/deploy/deploy', async (orig) => ({
  ...(await orig<typeof import('../src/deploy/deploy')>()),
  useDeploy: () => ({
    status: null,
    deployInfo: () => ({ deployedSha: null, changed: [] }),
    refresh: () => Promise.resolve(),
    rebuild: () => Promise.resolve()
  })
}))

afterEach(cleanup)

const AUTHOR = { name: 'T', email: 't@x.dev' }

async function setup(opts: { failRegistry?: boolean } = {}) {
  const data = createMemoryDataPort()
  const real = createMemoryGitPort()
  await real.commitFile({
    path: 'taxonomy/categories.yaml',
    content: serializeCategories([
      { slug: 'eng', name: 'Engineering', parent: null }
    ]),
    message: 'seed',
    author: AUTHOR
  })
  const git = opts.failRegistry
    ? { ...real, readFile: () => Promise.reject(new Error('git down')) }
    : real
  const services = servicesFor(data, git, createMemoryIndexPort())

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServicesProvider services={services}>
        <DeployProvider>
          <IndexProvider>
            <TaxonomyProvider>{children}</TaxonomyProvider>
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    )
  }

  render(
    <Wrapper>
      <CategoryPicker
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        ariaLabel="Pick a category"
      />
    </Wrapper>
  )
}

describe('CategoryPicker', () => {
  // #914 / §4 row 22: the picker rejects free text, so when the registry read fails it
  // offers an empty list the user cannot get past — and says nothing at all about why.
  it('says the category list could not be loaded when the registry read fails', async () => {
    await setup({ failRegistry: true })
    const notice = await screen.findByText(/couldn’t load categories/i)
    expect(notice.textContent).toMatch(/reload|try again/i)
  })

  it('says nothing when the registry loads', async () => {
    await setup()
    fireEvent.focus(screen.getByLabelText('Pick a category'))
    await waitFor(() =>
      expect(screen.queryByText('Engineering')).not.toBeNull()
    )
    expect(screen.queryByText(/couldn’t load categories/i)).toBeNull()
  })
})
