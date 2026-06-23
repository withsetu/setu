import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

// Radix Select calls scrollIntoView when the dropdown opens — stub it for jsdom.
beforeAll(() => {
  if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})
import { MemoryRouter } from 'react-router-dom'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { NotificationProvider } from '../src/ui/notify'
import { CategoriesTab } from '../src/screens/taxonomies/CategoriesTab'

vi.mock('../src/deploy/deploy', async (orig) => ({
  ...(await orig() as object),
  useDeploy: () => ({ deployedAt: () => null, sha: null, deploy: () => Promise.resolve() }),
}))

// Seed a 2-level tree:
//   eng  (depth 0) — parent: null
//   └── frontend (depth 1) — parent: eng
const SEED_YAML = `- slug: eng
  name: Engineering
  parent: null
- slug: frontend
  name: Frontend
  parent: eng
`

function wrap() {
  const gitPort = createMemoryGitPort([{ path: 'taxonomy/categories.yaml', content: SEED_YAML }])
  const services = servicesFor(createMemoryDataPort(), gitPort)
  return render(
    <MemoryRouter>
      <ServicesProvider services={services}>
        <DeployProvider>
          <IndexProvider>
            <TaxonomyProvider>
              <NotificationProvider>
                <CategoriesTab />
              </NotificationProvider>
            </TaxonomyProvider>
          </IndexProvider>
        </DeployProvider>
      </ServicesProvider>
    </MemoryRouter>,
  )
}

describe('CategoriesTab', () => {
  it('renders a child row (Frontend)', async () => {
    wrap()
    const frontendInput = await screen.findByDisplayValue('Frontend')
    expect(frontendInput).toBeInTheDocument()
  })

  it('child row (Frontend) is indented via paddingLeft style', async () => {
    wrap()
    const frontendInput = await screen.findByDisplayValue('Frontend')
    // The row div has paddingLeft set inline for depth=1 → 16 + 1*20 = 36px
    // Walk up to find the row that has a non-16px paddingLeft
    let el: HTMLElement | null = frontendInput.parentElement
    let found = false
    while (el) {
      const pl = el.style?.paddingLeft
      if (pl && pl !== '16px') {
        found = true
        break
      }
      el = el.parentElement
    }
    expect(found).toBe(true)
  })

  it('renders "Used by" column header', async () => {
    wrap()
    expect(await screen.findByText(/used by/i)).toBeInTheDocument()
  })

  it('renders "unused" for categories with no count', async () => {
    wrap()
    // Both categories start with no entries in the memory db
    const unusedCells = await screen.findAllByText('unused')
    expect(unusedCells.length).toBeGreaterThanOrEqual(1)
  })

  it('Move-to picker for "eng" (parent) excludes itself and its descendant "frontend"', async () => {
    wrap()
    // Wait for Engineering row to be rendered
    await screen.findByDisplayValue('Engineering')

    // aria-label on name input is "Name of eng"
    const engNameInput = screen.getByLabelText('Name of eng')
    // Walk up to find the row container div
    const row = engNameInput.closest('div[style]') as HTMLElement
    expect(row).toBeTruthy()

    // The SelectTrigger is within the row
    const trigger = within(row).getByRole('combobox')

    // Radix Select opens on Space/ArrowDown key (OPEN_KEYS in Radix Select source)
    trigger.focus()
    fireEvent.keyDown(trigger, { key: ' ', code: 'Space' })

    // After opening the select, check that 'eng' and 'frontend' slugs are NOT offered
    const listbox = await screen.findByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    const optionTexts = options.map((o) => o.textContent)

    // Must NOT contain Engineering (eng itself) or Frontend (its descendant)
    expect(optionTexts).not.toContain('Engineering')
    expect(optionTexts).not.toContain('Frontend')
    // Must contain "Top level"
    expect(optionTexts).toContain('Top level')
  })

  it('delete trigger (trash icon) exists for each row', async () => {
    wrap()
    await screen.findByDisplayValue('Engineering')
    const deleteBtns = screen.getAllByRole('button', { name: /delete/i })
    expect(deleteBtns.length).toBeGreaterThanOrEqual(2)
  })
})
