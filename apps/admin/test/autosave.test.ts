import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { DraftInput, TiptapDoc } from '@setu/core'
import { useAutosave } from '../src/editor/useAutosave'
import type { SaveStatus } from '../src/editor/useAutosave'

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
      onStatus: (s: SaveStatus) => statuses.push(s),
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

// ---------------------------------------------------------------------------------
// #782 — a FAILED save must never be indistinguishable from a successful one. The
// loop used to await inside try/`finally` with no catch and no look at the declared
// `{ saved }`, so a rejection (offline, 5xx, throwing DataPort) or a refusal (the
// draft lock is held → `{ saved: false }`, nothing written) cleared `dirty` and
// reported 'saved'. That disarmed the #770 tab-close warning in exactly the case
// where work is provably unwritten. Coverage was vacuous: the only rejecting test
// asserted that settled() resolved, and nothing else.
// ---------------------------------------------------------------------------------

describe('useAutosave — a failed save is reported as failed (#782)', () => {
  const props = (
    rev: number,
    save: Save,
    onStatus: (s: SaveStatus) => void
  ) => ({
    enabled: true,
    rev,
    getInput: input,
    save,
    onStatus,
    delayMs: 800
  })

  it('a REJECTED save reports error, keeps dirty, and keeps the tab-close warning armed', async () => {
    const save = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as Save
    const statuses: SaveStatus[] = []
    const { rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0, save, (s) => statuses.push(s))
    })
    rerender(props(1, save, (s) => statuses.push(s)))
    await vi.advanceTimersByTimeAsync(800)

    expect(save).toHaveBeenCalledTimes(1)
    expect(statuses).toContain('saving')
    expect(statuses).not.toContain('saved')
    expect(statuses.at(-1)).toBe('error')
    // dirty is not observable directly — the tab-close warning IS the observable.
    expect(fireBeforeUnload()).toBe(true)
  })

  it('a `{ saved: false }` refusal (lock held — nothing written) is a failure too', async () => {
    const save = vi.fn(async () => ({ saved: false }))
    const statuses: SaveStatus[] = []
    const { rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0, save, (s) => statuses.push(s))
    })
    rerender(props(1, save, (s) => statuses.push(s)))
    await vi.advanceTimersByTimeAsync(800)

    expect(statuses).not.toContain('saved')
    expect(statuses.at(-1)).toBe('error')
    expect(fireBeforeUnload()).toBe(true)
  })

  it('a later successful save clears the failure: error → saved, warning disarmed', async () => {
    let fail = true
    const save = vi.fn(async () => {
      if (fail) throw new Error('offline')
      return { saved: true }
    }) as unknown as Save
    const statuses: SaveStatus[] = []
    const { rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0, save, (s) => statuses.push(s))
    })
    rerender(props(1, save, (s) => statuses.push(s)))
    await vi.advanceTimersByTimeAsync(800)
    expect(statuses.at(-1)).toBe('error')

    fail = false
    rerender(props(2, save, (s) => statuses.push(s)))
    await vi.advanceTimersByTimeAsync(800)

    expect(statuses.at(-1)).toBe('saved')
    expect(fireBeforeUnload()).toBe(false)
  })

  it('a follow-up queued behind a failed save still reports the follow-up honestly', async () => {
    // save #1 freezes in flight and then rejects; the queued follow-up succeeds —
    // it writes the NEWEST buffer, so the drain is a real save.
    let rejectFirst!: (e: Error) => void
    const first = new Promise<{ saved: boolean }>((_, rj) => {
      rejectFirst = rj
    })
    let call = 0
    const save = vi.fn(() =>
      call++ === 0 ? first : Promise.resolve({ saved: true })
    )
    const statuses: SaveStatus[] = []
    const { rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0, save, (s) => statuses.push(s))
    })
    rerender(props(1, save, (s) => statuses.push(s)))
    await vi.advanceTimersByTimeAsync(800)
    rerender(props(2, save, (s) => statuses.push(s)))
    await vi.advanceTimersByTimeAsync(800) // queued behind the frozen save

    rejectFirst(new Error('offline'))
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(2)
    expect(statuses.at(-1)).toBe('saved')
    expect(fireBeforeUnload()).toBe(false)
  })
})

// ---------------------------------------------------------------------------------
// #1195 — an edit that arrives while a save is in flight, but whose debounce has not
// fired yet, is NOT queued as a follow-up (`pending` is only set when the timer fires
// mid-flight). The in-flight save's `finally` used to see an empty queue, clear
// `dirty` and report 'saved' for the OLDER buffer — so an unmount inside the new
// debounce window cancelled the timer and skipped the flush, and a tab close in the
// same window returned without warning. The newest edit was lost silently.
// ---------------------------------------------------------------------------------

describe('useAutosave — an edit made during an in-flight save survives (#1195)', () => {
  /** A save whose every call freezes until the test releases it, recording the
   *  buffer each call wrote. */
  function recordingSave(): {
    save: Save
    written: string[]
    release: (i: number) => void
  } {
    const written: string[] = []
    const releases: Array<() => void> = []
    const save = vi.fn((d: DraftInput) => {
      written.push(String(d.metadata['body']))
      return new Promise<{ saved: boolean }>((r) =>
        releases.push(() => r({ saved: true }))
      )
    })
    return { save, written, release: (i) => releases[i]?.() }
  }

  /** Drive: edit 'A' → its save starts → edit 'AB' while it is in flight → the
   *  first save resolves, all inside the 'AB' debounce window. */
  async function editDuringFlight() {
    let buffer = 'A'
    const rec = recordingSave()
    const statuses: SaveStatus[] = []
    const props = (rev: number) => ({
      enabled: true,
      rev,
      getInput: (): DraftInput => ({ ...input(), metadata: { body: buffer } }),
      save: rec.save,
      onStatus: (s: SaveStatus) => statuses.push(s),
      delayMs: 800
    })
    const hook = renderHook((p) => useAutosave(p), { initialProps: props(0) })
    hook.rerender(props(1))
    await vi.advanceTimersByTimeAsync(800)
    expect(rec.written).toEqual(['A']) // save #1 is in flight with 'A'
    buffer = 'AB'
    hook.rerender(props(2)) // newer edit: debounce scheduled, not yet fired
    await vi.advanceTimersByTimeAsync(100)
    rec.release(0) // save #1 resolves — 'AB' is still unwritten
    await vi.advanceTimersByTimeAsync(0)
    return { ...hook, ...rec, statuses }
  }

  it('does not report "saved" for the older buffer while the newer edit is pending', async () => {
    const { statuses } = await editDuringFlight()
    expect(statuses).not.toContain('saved')
    expect(statuses.at(-1)).toBe('pending')
  })

  it('unmount inside the new debounce window flushes the newer edit', async () => {
    const { unmount, written, release } = await editDuringFlight()
    unmount()
    release(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(written).toEqual(['A', 'AB'])
  })

  it('a tab close inside the new debounce window warns and flushes the newer edit', async () => {
    const { written } = await editDuringFlight()
    expect(fireBeforeUnload()).toBe(true)
    expect(written).toEqual(['A', 'AB'])
  })

  it('left alone, the newer edit saves on its own debounce and only then reports saved', async () => {
    const { written, statuses, release } = await editDuringFlight()
    await vi.advanceTimersByTimeAsync(800) // the 'AB' debounce fires
    expect(written).toEqual(['A', 'AB'])
    release(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(statuses.at(-1)).toBe('saved')
    expect(fireBeforeUnload()).toBe(false)
  })
})

describe('useAutosave — a new edit after a completed save is reported pending (#1195)', () => {
  it('flips "saved" to "pending" on the next change, before its debounce fires', async () => {
    const save = vi.fn(async () => ({ saved: true }))
    const statuses: SaveStatus[] = []
    const props = (rev: number) => ({
      enabled: true,
      rev,
      getInput: input,
      save,
      onStatus: (s: SaveStatus) => statuses.push(s),
      delayMs: 800
    })
    const { rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0)
    })
    rerender(props(1))
    await vi.advanceTimersByTimeAsync(800)
    expect(statuses.at(-1)).toBe('saved')
    rerender(props(2))
    expect(statuses.at(-1)).toBe('pending')
  })

  it('keeps an "error" on screen through the next change — that work is still not backed up', async () => {
    const save = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as Save
    const statuses: SaveStatus[] = []
    const props = (rev: number) => ({
      enabled: true,
      rev,
      getInput: input,
      save,
      onStatus: (s: SaveStatus) => statuses.push(s),
      delayMs: 800
    })
    const { rerender } = renderHook((p) => useAutosave(p), {
      initialProps: props(0)
    })
    rerender(props(1))
    await vi.advanceTimersByTimeAsync(800)
    expect(statuses.at(-1)).toBe('error')
    rerender(props(2))
    expect(statuses.at(-1)).toBe('error')
  })
})
