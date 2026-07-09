import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { RenameResult } from '@setu/core'
import { SlugField } from '../src/editor/SlugField'

const ok: RenameResult = { renamed: true, committedSha: null }
const refuse = (reason: NonNullable<RenameResult['reason']>): RenameResult => ({
  renamed: false,
  committedSha: null,
  reason
})

function setup(props?: Partial<React.ComponentProps<typeof SlugField>>) {
  const onRename = vi.fn(async (): Promise<RenameResult> => ok)
  const defaults: React.ComponentProps<typeof SlugField> = {
    slug: 'my-post',
    collection: 'post',
    locale: 'en',
    editable: true,
    committed: false,
    permalinkConfig: {
      pattern: ':collection/:slug',
      uncategorized: 'uncategorized'
    },
    date: Date.UTC(2026, 6, 4),
    categories: [],
    onRename
  }
  const view = render(<SlugField {...defaults} {...props} />)
  return { onRename, view }
}

const input = () => screen.getByRole('textbox', { name: 'Slug' })
const applyBtn = () => screen.getByRole('button', { name: 'Apply slug' })

describe('SlugField — staging and applying', () => {
  it('renders the current slug and no apply/revert controls while clean', () => {
    setup()
    expect(input()).toHaveValue('my-post')
    expect(screen.queryByRole('button', { name: 'Apply slug' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revert slug' })).toBeNull()
  })

  it('typing stages only — onRename is not called until apply', () => {
    const { onRename } = setup()
    fireEvent.change(input(), { target: { value: 'other-slug' } })
    expect(onRename).not.toHaveBeenCalled()
    expect(applyBtn()).toBeInTheDocument()
  })

  it('Enter applies the slugified staged value', async () => {
    const { onRename } = setup()
    fireEvent.change(input(), { target: { value: 'My New Slug!' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('my-new-slug'))
  })

  it('the apply button applies too', async () => {
    const { onRename } = setup()
    fireEvent.change(input(), { target: { value: 'fresh-slug' } })
    fireEvent.click(applyBtn())
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('fresh-slug'))
  })

  it('Esc reverts the staged text to the current slug', () => {
    const { onRename } = setup()
    fireEvent.change(input(), { target: { value: 'abandoned' } })
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(input()).toHaveValue('my-post')
    expect(onRename).not.toHaveBeenCalled()
  })

  it('the revert button reverts too', () => {
    setup()
    fireEvent.change(input(), { target: { value: 'abandoned' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revert slug' }))
    expect(input()).toHaveValue('my-post')
  })

  it('shows the will-save-as hint when the staged text needs cleaning', () => {
    setup()
    fireEvent.change(input(), { target: { value: 'Hello World' } })
    expect(screen.getByText(/will save as:/)).toHaveTextContent(
      'will save as: hello-world'
    )
  })

  it('disables apply for empty / symbol-only staged text', () => {
    setup()
    fireEvent.change(input(), { target: { value: '???' } })
    expect(applyBtn()).toBeDisabled()
    fireEvent.keyDown(input(), { key: 'Enter' })
  })

  it('re-syncs from the slug prop after a successful rename (navigation)', () => {
    const { view } = setup()
    fireEvent.change(input(), { target: { value: 'renamed' } })
    view.rerender(
      <SlugField
        slug="renamed"
        collection="post"
        locale="en"
        editable
        committed={false}
        permalinkConfig={{
          pattern: ':collection/:slug',
          uncategorized: 'uncategorized'
        }}
        date={null}
        categories={[]}
        onRename={vi.fn(async () => ok)}
      />
    )
    expect(input()).toHaveValue('renamed')
  })

  it('is disabled when not editable', () => {
    setup({ editable: false })
    expect(input()).toBeDisabled()
  })
})

describe('SlugField — refusal errors', () => {
  it('target-exists shows the destructive inline error and marks the input invalid', async () => {
    setup({ onRename: vi.fn(async () => refuse('target-exists')) })
    fireEvent.change(input(), { target: { value: 'taken' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(
      await screen.findByText(
        'Already used by another entry in this collection/locale.'
      )
    ).toBeInTheDocument()
    expect(input()).toHaveAttribute('aria-invalid', 'true')
  })

  it('invalid-slug shows a matching short error', async () => {
    setup({ onRename: vi.fn(async () => refuse('invalid-slug')) })
    fireEvent.change(input(), { target: { value: 'new' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(
      await screen.findByText(/lowercase letters, numbers, and hyphens/i)
    ).toBeInTheDocument()
  })
})

describe('SlugField — URL preview', () => {
  it('shows the resolved full URL for the current slug', () => {
    setup()
    expect(screen.getByText('localhost:4321/post/my-post')).toBeInTheDocument()
  })

  it('live-updates the preview as the staged slug changes', () => {
    setup()
    fireEvent.change(input(), { target: { value: 'Brand New' } })
    expect(
      screen.getByText('localhost:4321/post/brand-new')
    ).toBeInTheDocument()
  })

  it('resolves date tokens from the entry date', () => {
    setup({
      permalinkConfig: {
        pattern: ':year/:month/:slug',
        uncategorized: 'uncategorized'
      },
      date: Date.UTC(2026, 6, 4)
    })
    expect(
      screen.getByText('localhost:4321/2026/07/my-post')
    ).toBeInTheDocument()
  })

  it('shows the amber no-date hint when a date-token pattern has no date', () => {
    setup({
      permalinkConfig: {
        pattern: ':year/:month/:slug',
        uncategorized: 'uncategorized'
      },
      date: null
    })
    expect(
      screen.getByText('No publish date — using /my-post')
    ).toBeInTheDocument()
    expect(screen.getByText('localhost:4321/my-post')).toBeInTheDocument()
  })

  it('shows no date hint when the pattern has no date tokens', () => {
    setup({ date: null })
    expect(screen.queryByText(/No publish date/)).toBeNull()
  })
})

describe('SlugField — redirect honesty', () => {
  it('shows the 301-after-rebuild hint while a rename is staged on a committed entry', () => {
    setup({ committed: true })
    expect(screen.queryByText(/redirect \(301\)/)).toBeNull()
    fireEvent.change(input(), { target: { value: 'moved' } })
    expect(
      screen.getByText(
        'The old URL will redirect (301) after the next site rebuild.'
      )
    ).toBeInTheDocument()
  })

  it('never shows the redirect hint for an uncommitted entry', () => {
    setup({ committed: false })
    fireEvent.change(input(), { target: { value: 'moved' } })
    expect(screen.queryByText(/redirect \(301\)/)).toBeNull()
  })
})
