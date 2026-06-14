import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { TiptapDoc } from '@saytu/core'
import { useAutosave } from '../src/editor/useAutosave'

const emptyDoc: TiptapDoc = { type: 'doc', content: [] }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useAutosave', () => {
  it('debounces and calls save once after the delay; emits saving then saved', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const statuses: string[] = []
    const props = (rev: number) => ({
      enabled: true,
      rev,
      getInput: () => ({ collection: 'post', locale: 'en', slug: 'x', content: emptyDoc, metadata: {}, baseSha: null }),
      save,
      onStatus: (s: 'idle' | 'saving' | 'saved') => statuses.push(s),
      delayMs: 800,
    })
    const { rerender } = renderHook((p) => useAutosave(p), { initialProps: props(0) })
    rerender(props(1))
    await vi.advanceTimersByTimeAsync(800)
    expect(save).toHaveBeenCalledTimes(1)
    expect(statuses).toContain('saving')
    expect(statuses).toContain('saved')
  })

  it('does not save on the initial rev (rev 0)', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const base = {
      enabled: true, rev: 0,
      getInput: () => ({ collection: 'post', locale: 'en', slug: 'x', content: emptyDoc, metadata: {}, baseSha: null }),
      save, onStatus: () => {}, delayMs: 800,
    }
    const { rerender } = renderHook((p) => useAutosave(p), { initialProps: base })
    rerender({ ...base })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
  })

  it('saves exactly once per change — no idle resave loop', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const onStatus = vi.fn()
    const base = {
      enabled: true,
      getInput: () => ({ collection: 'post', locale: 'en', slug: 'x', content: emptyDoc, metadata: {}, baseSha: null }),
      save,
      onStatus,
      delayMs: 800,
    }
    // NEW closures each render (mimics EditorScreen) but the same rev.
    const { rerender } = renderHook((p) => useAutosave(p), { initialProps: { ...base, rev: 0 } })
    rerender({ ...base, getInput: () => ({ collection: 'post', locale: 'en', slug: 'x', content: emptyDoc, metadata: {}, baseSha: null }), rev: 1 })
    await vi.advanceTimersByTimeAsync(800)
    expect(save).toHaveBeenCalledTimes(1)
    // Idle: keep re-rendering with NEW closures but the SAME rev, advancing time.
    for (let i = 0; i < 4; i++) {
      rerender({ ...base, getInput: () => ({ collection: 'post', locale: 'en', slug: 'x', content: emptyDoc, metadata: {}, baseSha: null }), rev: 1 })
      await vi.advanceTimersByTimeAsync(800)
    }
    expect(save).toHaveBeenCalledTimes(1) // still exactly one — no idle resave loop
  })
})
