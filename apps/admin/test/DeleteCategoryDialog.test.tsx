import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { NotificationProvider } from '../src/ui/notify'
import { DeleteCategoryDialog } from '../src/screens/taxonomies/DeleteCategoryDialog'
import type { CategoryNode } from '@setu/core'

vi.mock('../src/deploy/deploy', async (orig) => ({
  ...(await orig()),
  useDeploy: () => ({
    status: null,
    deployInfo: () => ({ deployedSha: null, changed: [] }),
    refresh: () => Promise.resolve(),
    rebuild: () => Promise.resolve()
  })
}))

// jsdom does not implement scrollIntoView — stub it.
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
}

afterEach(cleanup)

function makeNode(overrides: Partial<CategoryNode> = {}): CategoryNode {
  return {
    slug: 'tech',
    name: 'Tech',
    parent: null,
    depth: 0,
    children: [],
    ...overrides
  }
}

function childNode(): CategoryNode {
  const child: CategoryNode = {
    slug: 'js',
    name: 'JavaScript',
    parent: 'tech',
    depth: 1,
    children: []
  }
  return child
}

/** Minimal provider wrapper — no seeded categories, but with taxonomy context. */
function Wrapper({ children }: { children: ReactNode }) {
  const services = servicesFor(createMemoryDataPort(), createMemoryGitPort())
  return (
    <ServicesProvider services={services}>
      <DeployProvider>
        <IndexProvider>
          <TaxonomyProvider>
            <NotificationProvider>{children}</NotificationProvider>
          </TaxonomyProvider>
        </IndexProvider>
      </DeployProvider>
    </ServicesProvider>
  )
}

describe('DeleteCategoryDialog', () => {
  it('does not render dialog content when node is null', () => {
    render(
      <Wrapper>
        <DeleteCategoryDialog node={null} onClose={vi.fn()} />
      </Wrapper>
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows the category name in the title', () => {
    const node = makeNode()
    render(
      <Wrapper>
        <DeleteCategoryDialog node={node} onClose={vi.fn()} />
      </Wrapper>
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText(/delete "Tech"/i)).toBeInTheDocument()
  })

  it('shows "not used by any content" when count is 0', () => {
    const node = makeNode()
    render(
      <Wrapper>
        <DeleteCategoryDialog node={node} onClose={vi.fn()} />
      </Wrapper>
    )
    expect(screen.getByText(/isn't used by any content/i)).toBeInTheDocument()
  })

  it('shows "Used by 3 entries" when counts[slug]=3 and children note when node has children', async () => {
    const child = childNode()
    const node = makeNode({ children: [child] })

    // Counts are seeded by spying on useTaxonomy below (TaxonomyProvider exposes no
    // setCount API, so mocking the hook is the direct route).
    const removeFn = vi.fn().mockResolvedValue(undefined)
    const spy = vi
      .spyOn(await import('../src/data/taxonomy-store'), 'useTaxonomy')
      .mockReturnValue({
        categories: [],
        counts: { tech: 3 },
        create: vi.fn(),
        renameLabel: vi.fn(),
        reparent: vi.fn(),
        remove: removeFn
      })

    try {
      render(
        <Wrapper>
          <DeleteCategoryDialog node={node} onClose={vi.fn()} />
        </Wrapper>
      )
      expect(screen.getByText(/used by 3 entries/i)).toBeInTheDocument()
      expect(screen.getByText(/move up one level/i)).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  it('singular: shows "Used by 1 entry" when count is 1', async () => {
    const node = makeNode()
    const removeFn = vi.fn().mockResolvedValue(undefined)
    const spy = vi
      .spyOn(await import('../src/data/taxonomy-store'), 'useTaxonomy')
      .mockReturnValue({
        categories: [],
        counts: { tech: 1 },
        create: vi.fn(),
        renameLabel: vi.fn(),
        reparent: vi.fn(),
        remove: removeFn
      })
    try {
      render(
        <Wrapper>
          <DeleteCategoryDialog node={node} onClose={vi.fn()} />
        </Wrapper>
      )
      expect(screen.getByText(/used by 1 entry/i)).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  it('clicking Delete calls remove(slug) and then onClose', async () => {
    const node = makeNode()
    const removeFn = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const spy = vi
      .spyOn(await import('../src/data/taxonomy-store'), 'useTaxonomy')
      .mockReturnValue({
        categories: [],
        counts: {},
        create: vi.fn(),
        renameLabel: vi.fn(),
        reparent: vi.fn(),
        remove: removeFn
      })
    try {
      render(
        <Wrapper>
          <DeleteCategoryDialog node={node} onClose={onClose} />
        </Wrapper>
      )
      fireEvent.click(screen.getByRole('button', { name: /delete/i }))
      await waitFor(() => expect(removeFn).toHaveBeenCalledWith('tech'))
      // onClose may be called more than once (our confirm() + Radix onOpenChange); just
      // assert it was called at least once.
      await waitFor(() => expect(onClose).toHaveBeenCalled())
    } finally {
      spy.mockRestore()
    }
  })

  it('clicking Cancel calls onClose without calling remove', async () => {
    const node = makeNode()
    const removeFn = vi.fn()
    const onClose = vi.fn()
    const spy = vi
      .spyOn(await import('../src/data/taxonomy-store'), 'useTaxonomy')
      .mockReturnValue({
        categories: [],
        counts: {},
        create: vi.fn(),
        renameLabel: vi.fn(),
        reparent: vi.fn(),
        remove: removeFn
      })
    try {
      render(
        <Wrapper>
          <DeleteCategoryDialog node={node} onClose={onClose} />
        </Wrapper>
      )
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
      expect(removeFn).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('no children: does not show "move up one level" copy', async () => {
    const node = makeNode({ children: [] })
    const spy = vi
      .spyOn(await import('../src/data/taxonomy-store'), 'useTaxonomy')
      .mockReturnValue({
        categories: [],
        counts: { tech: 2 },
        create: vi.fn(),
        renameLabel: vi.fn(),
        reparent: vi.fn(),
        remove: vi.fn().mockResolvedValue(undefined)
      })
    try {
      render(
        <Wrapper>
          <DeleteCategoryDialog node={node} onClose={vi.fn()} />
        </Wrapper>
      )
      expect(screen.queryByText(/move up one level/i)).not.toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })
})
