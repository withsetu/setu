import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LinkPopup } from '../src/editor/LinkPopup'
import { shouldShowLinkCard } from '../src/editor/extensions/LinkTools'

afterEach(cleanup)

describe('shouldShowLinkCard', () => {
  it('shows only for an empty selection inside a link with an href', () => {
    expect(shouldShowLinkCard(true, true, 'https://x.com')).toBe(true)
    expect(shouldShowLinkCard(false, true, 'https://x.com')).toBe(false) // non-empty selection → format bubble owns it
    expect(shouldShowLinkCard(true, false, '')).toBe(false) // caret not in a link
    expect(shouldShowLinkCard(true, true, '')).toBe(false) // no href
  })
  it('shows for an empty selection inside a link with an href (dismissed=false explicit)', () => {
    expect(shouldShowLinkCard(true, true, 'https://x.com', false)).toBe(true)
  })
  it('does not show when the card was dismissed for this link', () => {
    expect(shouldShowLinkCard(true, true, 'https://x.com', true)).toBe(false)
  })
  it('does not show without a selection-empty link+href', () => {
    expect(shouldShowLinkCard(false, true, 'https://x.com', false)).toBe(false)
    expect(shouldShowLinkCard(true, false, 'https://x.com', false)).toBe(false)
    expect(shouldShowLinkCard(true, true, '', false)).toBe(false)
  })
})

describe('LinkPopup', () => {
  it('renders the href as an Open link to a new tab', () => {
    render(
      <LinkPopup
        href="https://x.com"
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        editable
      />
    )
    const open = screen.getByRole('link', { name: /open/i })
    expect(open).toHaveAttribute('href', 'https://x.com')
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('shows Edit/Remove when editable and calls them', () => {
    const onEdit = vi.fn()
    const onRemove = vi.fn()
    render(
      <LinkPopup
        href="https://x.com"
        onEdit={onEdit}
        onRemove={onRemove}
        editable
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('hides Edit/Remove when not editable (read-only) but keeps Open', () => {
    render(
      <LinkPopup
        href="https://x.com"
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        editable={false}
      />
    )
    expect(screen.getByRole('link', { name: /open/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /edit/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /remove/i })
    ).not.toBeInTheDocument()
  })
})
