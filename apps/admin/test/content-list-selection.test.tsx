import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { TiptapDoc } from '@setu/core'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryDataPort } from '@setu/db-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { NotificationProvider } from '../src/ui/notify'
import { ActorProvider } from '../src/auth/actor'
import { ContentList } from '../src/screens/ContentList'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})

function setup() {
  const data = createMemoryDataPort([
    {
      collection: 'post',
      locale: 'en',
      slug: 'alpha',
      content: doc('x'),
      metadata: { title: 'Alpha' }
    },
    {
      collection: 'post',
      locale: 'en',
      slug: 'beta',
      content: doc('x'),
      metadata: { title: 'Beta' }
    }
  ])
  render(
    <MemoryRouter initialEntries={['/posts']}>
      <ServicesProvider services={servicesFor(data, createMemoryGitPort())}>
        <DeployProvider>
          <IndexProvider>
            <TaxonomyProvider>
              <NotificationProvider>
                <ActorProvider>
                  <ContentList collection="post" title="Posts" />
                </ActorProvider>
              </NotificationProvider>
            </TaxonomyProvider>
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    </MemoryRouter>
  )
}

describe('ContentList — selection', () => {
  it('selects a row and shows the count, then clears', async () => {
    setup()
    await screen.findByText('Alpha')
    fireEvent.click(screen.getByLabelText('Select Alpha'))
    expect(await screen.findByText(/1 selected/i)).toBeTruthy()
    fireEvent.click(screen.getByText(/clear selection/i))
    await waitFor(() => expect(screen.queryByText(/selected/i)).toBeNull())
  })

  it('select-all-page toggles every row', async () => {
    setup()
    await screen.findByText('Alpha')
    fireEvent.click(screen.getByLabelText('Select all on this page'))
    expect(await screen.findByText(/2 selected/i)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Select all on this page'))
    await waitFor(() => expect(screen.queryByText(/selected/i)).toBeNull())
  })
})
