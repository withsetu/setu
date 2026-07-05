import { describe, it, expect, vi } from 'vitest'
import {
  onRequestLinkEdit,
  requestLinkEdit,
  onRequestShortcuts,
  requestShortcuts,
  onRequestFocusToolbar,
  requestFocusToolbar
} from '../src/editor/editor-events'

describe('editor-events', () => {
  it('notifies link-edit subscribers and stops after unsubscribe', () => {
    const cb = vi.fn()
    const off = onRequestLinkEdit(cb)
    requestLinkEdit()
    requestLinkEdit()
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    requestLinkEdit()
    expect(cb).toHaveBeenCalledTimes(2)
  })
  it('has an independent shortcuts channel', () => {
    const link = vi.fn()
    const sc = vi.fn()
    onRequestLinkEdit(link)
    onRequestShortcuts(sc)
    requestShortcuts()
    expect(sc).toHaveBeenCalledOnce()
    expect(link).not.toHaveBeenCalled()
  })
  it('has an independent focus-toolbar channel', () => {
    const ft = vi.fn()
    const link = vi.fn()
    onRequestFocusToolbar(ft)
    onRequestLinkEdit(link)
    requestFocusToolbar()
    expect(ft).toHaveBeenCalledOnce()
    expect(link).not.toHaveBeenCalled()
  })
})
