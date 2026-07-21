import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { DraftInput, TiptapDoc } from '@setu/core'
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
      getInput: () => ({
        collection: 'post',
        locale: 'en',
        slug: 'x',
        content: emptyDoc,
        metadata: {},
        baseSha: null
      }),
      save,
      onStatus: (s: 'idle' | 'saving' | 'saved') => statuses.push(s),
      delayMs: 800
    })
    const { rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0)
    })
    rerender(props(1))
    await vi.advanceTimersByTimeAsync(800)
    expect(save).toHaveBeenCalledTimes(1)
    expect(statuses).toContain('saving')
    expect(statuses).toContain('saved')
  })

  it('does not save on the initial rev (rev 0)', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const base = {
      enabled: true,
      rev: 0,
      getInput: () => ({
        collection: 'post',
        locale: 'en',
        slug: 'x',
        content: emptyDoc,
        metadata: {},
        baseSha: null
      }),
      save,
      onStatus: () => {},
      delayMs: 800
    }
    const { rerender } = renderHook((p) => useAutosave(p), {
      initialProps: base
    })
    rerender({ ...base })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
  })

  it('saves exactly once per change — no idle resave loop', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const onStatus = vi.fn()
    const base = {
      enabled: true,
      getInput: () => ({
        collection: 'post',
        locale: 'en',
        slug: 'x',
        content: emptyDoc,
        metadata: {},
        baseSha: null
      }),
      save,
      onStatus,
      delayMs: 800
    }
    // NEW closures each render (mimics EditorScreen) but the same rev.
    const { rerender } = renderHook((p) => useAutosave(p), {
      initialProps: { ...base, rev: 0 }
    })
    rerender({
      ...base,
      getInput: () => ({
        collection: 'post',
        locale: 'en',
        slug: 'x',
        content: emptyDoc,
        metadata: {},
        baseSha: null
      }),
      rev: 1
    })
    await vi.advanceTimersByTimeAsync(800)
    expect(save).toHaveBeenCalledTimes(1)
    // Idle: keep re-rendering with NEW closures but the SAME rev, advancing time.
    for (let i = 0; i < 4; i++) {
      rerender({
        ...base,
        getInput: () => ({
          collection: 'post',
          locale: 'en',
          slug: 'x',
          content: emptyDoc,
          metadata: {},
          baseSha: null
        }),
        rev: 1
      })
      await vi.advanceTimersByTimeAsync(800)
    }
    expect(save).toHaveBeenCalledTimes(1) // still exactly one — no idle resave loop
  })

  it('flushes a pending save on unmount before the debounce fires (no lost change)', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const props = (rev: number) => ({
      enabled: true,
      rev,
      getInput: () => ({
        collection: 'post',
        locale: 'en',
        slug: 'x',
        content: emptyDoc,
        metadata: {},
        baseSha: null
      }),
      save,
      onStatus: () => {},
      delayMs: 800
    })
    const { rerender, unmount } = renderHook((p) => useAutosave(p), {
      initialProps: props(0)
    })
    rerender(props(1)) // a change is scheduled (debounce pending)
    // Unmount BEFORE advancing the timer — the debounced save never fires on its own.
    unmount()
    expect(save).toHaveBeenCalledTimes(1) // the unmount flush saved exactly once
  })
})

// ---------------------------------------------------------------------------------
// The imperative handle (pause/resume/settled) and the two flush paths that must
// respect it. #770: the beforeunload guard swallowed the browser's unsaved-work
// prompt whenever a save was in flight. #771: neither flush consulted `paused`,
// so a tab close (or unmount) mid-rename/restore bypassed the quiescence
// primitive and re-created / orphaned a draft.
// ---------------------------------------------------------------------------------

type Save = (input: DraftInput) => Promise<{ saved: boolean }>

const input = (): DraftInput => ({
  collection: 'post',
  locale: 'en',
  slug: 'x',
  content: emptyDoc,
  metadata: {},
  baseSha: null
})

/** A save frozen on a gate, so a test can hold one write in flight deterministically. */
function gatedSave(): { save: Save; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const save = vi.fn(async () => {
    await gate
    return { saved: true }
  })
  return { save, release }
}

/** Dispatch a real beforeunload and report whether the browser would warn. */
function fireBeforeUnload(): boolean {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
}

describe('useAutosave — beforeunload warning (#770)', () => {
  it('warns when dirty with nothing in flight, and flushes one save (case L)', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const props = (rev: number) => ({
      enabled: true,
      rev,
      getInput: input,
      save,
      onStatus: () => {},
      delayMs: 800
    })
    const { rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0)
    })
    rerender(props(1)) // dirty, debounce pending, nothing in flight
    expect(fireBeforeUnload()).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('STILL warns while a save is in flight with a queued follow-up (case K)', async () => {
    const { save, release } = gatedSave()
    const props = (rev: number) => ({
      enabled: true,
      rev,
      getInput: input,
      save,
      onStatus: () => {},
      delayMs: 800
    })
    const { rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0)
    })
    rerender(props(1))
    await vi.advanceTimersByTimeAsync(800) // save #1 starts and freezes in flight
    rerender(props(2))
    await vi.advanceTimersByTimeAsync(800) // newer edit queues behind it
    // That newer edit is provably unsaved — the browser MUST prompt.
    expect(fireBeforeUnload()).toBe(true)
    // …but no duplicate write while one is in flight.
    expect(save).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('does not warn when clean', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const props = (rev: number) => ({
      enabled: true,
      rev,
      getInput: input,
      save,
      onStatus: () => {},
      delayMs: 800
    })
    const { rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0)
    })
    rerender(props(1))
    await vi.advanceTimersByTimeAsync(800) // drains → clean
    expect(fireBeforeUnload()).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('useAutosave — handle: pause / resume / settled', () => {
  const props = (rev: number, save: Save) => ({
    enabled: true,
    rev,
    getInput: input,
    save,
    onStatus: () => {},
    delayMs: 800
  })

  it('pause blocks new saves; resume restores normal operation', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const { result, rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0, save)
    })
    result.current.pause()
    rerender(props(1, save))
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).not.toHaveBeenCalled()
    result.current.resume()
    rerender(props(2, save))
    await vi.advanceTimersByTimeAsync(800)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('settled() resolves immediately when idle', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const { result } = renderHook((p) => useAutosave(p), {
      initialProps: props(0, save)
    })
    let done = false
    void result.current.settled().then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })

  it('settled() waits out an in-flight save', async () => {
    const { save, release } = gatedSave()
    const { result, rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0, save)
    })
    rerender(props(1, save))
    await vi.advanceTimersByTimeAsync(800)
    let done = false
    void result.current.settled().then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })

  it('settled() resolves even when the in-flight save rejects', async () => {
    let reject!: (e: Error) => void
    const gate = new Promise<{ saved: boolean }>((_, rj) => {
      reject = rj
    })
    const save = vi.fn(() => gate)
    const { result, rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0, save)
    })
    rerender(props(1, save))
    await vi.advanceTimersByTimeAsync(800)
    let done = false
    void result.current.settled().then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    reject(new Error('offline'))
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
  })
})

describe('useAutosave — flushes respect the pause (#771)', () => {
  const props = (rev: number, save: Save) => ({
    enabled: true,
    rev,
    getInput: input,
    save,
    onStatus: () => {},
    delayMs: 800
  })

  it('the unmount flush does not write while paused', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const { result, rerender, unmount } = renderHook((p) => useAutosave(p), {
      initialProps: props(0, save)
    })
    rerender(props(1, save)) // dirty, debounce pending
    result.current.pause() // rename/restore owns storage now
    unmount()
    expect(save).not.toHaveBeenCalled()
  })

  it('the beforeunload flush does not write while paused (but still warns)', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const { result, rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0, save)
    })
    rerender(props(1, save))
    result.current.pause()
    expect(fireBeforeUnload()).toBe(true) // work is unsaved — still prompt
    expect(save).not.toHaveBeenCalled() // …but never write under the lifecycle op
  })

  it('pause({ discard: true }) drops the buffer: no warning and no flush write', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const { result, rerender, unmount } = renderHook((p) => useAutosave(p), {
      initialProps: props(0, save)
    })
    rerender(props(1, save))
    result.current.pause({ discard: true }) // restore: the buffer is being thrown away
    expect(fireBeforeUnload()).toBe(false)
    unmount()
    expect(save).not.toHaveBeenCalled()
  })
})
