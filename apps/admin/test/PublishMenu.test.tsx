import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { PublishMenu } from '../src/editor/PublishMenu'

// Radix DropdownMenu calls scrollIntoView when it opens — stub it for jsdom.
beforeAll(() => {
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.scrollIntoView
  ) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

const noop = () => {}

describe('PublishMenu', () => {
  it('renders nothing when neither publish nor unpublish is allowed', () => {
    const { container } = render(
      <PublishMenu
        canSaveDraft={false}
        canPublish={false}
        canUnpublish={false}
        isUnpublished={false}
        onSaveDraft={noop}
        onPublish={noop}
        onUnpublish={noop}
      />
    )
    expect(container.textContent).toBe('')
  })
  it('primary Publish calls onPublish', () => {
    const onPublish = vi.fn()
    render(
      <PublishMenu
        canSaveDraft={false}
        canPublish
        canUnpublish={false}
        isUnpublished={false}
        onSaveDraft={noop}
        onPublish={onPublish}
        onUnpublish={noop}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(onPublish).toHaveBeenCalledOnce()
  })
  it('menu offers Unpublish when published + can unpublish', () => {
    const onUnpublish = vi.fn()
    render(
      <PublishMenu
        canSaveDraft={false}
        canPublish
        canUnpublish
        isUnpublished={false}
        onSaveDraft={noop}
        onPublish={noop}
        onUnpublish={onUnpublish}
      />
    )
    // Radix DropdownMenu opens on Enter keydown (avoids PointerEvent jsdom issues)
    const trigger = screen.getByRole('button', { name: /more publish/i })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(screen.getByText('Unpublish'))
    expect(onUnpublish).toHaveBeenCalledOnce()
  })
})
