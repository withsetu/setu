import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

// Radix Select calls scrollIntoView when the dropdown opens — stub it for jsdom.
beforeAll(() => {
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.scrollIntoView
  ) {
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
  ...(await orig()),
  useDeploy: () => ({
    deployedAt: () => null,
    sha: null,
    deploy: () => Promise.resolve()
  })
}))

// Seed a 3-level tree (issue #385 asks that deeper nesting render sanely):
//   eng  (depth 0) — parent: null
//   └── frontend (depth 1) — parent: eng
//       └── react (depth 2) — parent: frontend
const SEED_YAML = `- slug: eng
  name: Engineering
  parent: null
- slug: frontend
  name: Frontend
  parent: eng
- slug: react
  name: React
  parent: frontend
`

function wrap() {
  const gitPort = createMemoryGitPort([
    { path: 'taxonomy/categories.yaml', content: SEED_YAML }
  ])
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
    </MemoryRouter>
  )
}

describe('CategoriesTab', () => {
  it('renders a child row (Frontend)', async () => {
    wrap()
    const frontendInput = await screen.findByDisplayValue('Frontend')
    expect(frontendInput).toBeInTheDocument()
  })

  // #385: alignment must come from real table semantics — every slug lives in the
  // same table column, so slugs share one x-position regardless of hierarchy depth.
  it('renders every slug in the same Slug table column', async () => {
    wrap()
    await screen.findByDisplayValue('Frontend')
    const table = screen.getByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    const slugIdx = headers.findIndex((h) => /slug/i.test(h.textContent ?? ''))
    expect(slugIdx).toBeGreaterThanOrEqual(0)
    // Body rows = all rows except the header row.
    const [, ...bodyRows] = within(table).getAllByRole('row')
    expect(bodyRows.length).toBe(3)
    const slugTexts = bodyRows.map(
      (row) => within(row).getAllByRole('cell')[slugIdx]?.textContent
    )
    expect(slugTexts).toEqual(['/eng', '/frontend', '/react'])
  })

  // #385: hierarchy indent applies to the NAME CELL's inner wrapper only — never to the
  // row element — so all other cells stay on the column grid.
  it('indents the name cell only, scaling with depth; the row itself is never indented', async () => {
    wrap()
    await screen.findByDisplayValue('Frontend')
    const depths: Array<[string, number]> = [
      ['Engineering', 0],
      ['Frontend', 1],
      ['React', 2]
    ]
    for (const [name, depth] of depths) {
      const input = screen.getByDisplayValue(name)
      const row = input.closest('tr')
      expect(row).toBeTruthy()
      // The row element carries no indent of its own.
      expect(row!.style.paddingLeft).toBe('')
      // The indent lives on a wrapper INSIDE the name cell.
      const nameCell = input.closest('td')
      expect(nameCell).toBeTruthy()
      const wrapper = input.closest<HTMLElement>('[style]')
      expect(wrapper).toBeTruthy()
      expect(nameCell!.contains(wrapper)).toBe(true)
      expect(wrapper!.style.paddingLeft).toBe(`${depth * 20}px`)
    }
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
    const row = engNameInput.closest('tr') as HTMLElement
    expect(row).toBeTruthy()

    // The SelectTrigger is within the row
    const trigger = within(row).getByRole('combobox')

    // Radix Select opens on Space/ArrowDown key (OPEN_KEYS in Radix Select source)
    trigger.focus()
    fireEvent.keyDown(trigger, { key: ' ', code: 'Space' })

    // After opening the select, check that eng and its descendants are NOT offered
    const listbox = await screen.findByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    const optionTexts = options.map((o) => o.textContent)

    // Must NOT contain Engineering (eng itself) or its descendants Frontend/React
    expect(optionTexts).not.toContain('Engineering')
    expect(optionTexts).not.toContain('Frontend')
    expect(optionTexts).not.toContain('React')
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
