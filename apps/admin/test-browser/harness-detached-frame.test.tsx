import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { SliderControl } from '../src/editor/controls/slider'
import type { ControlMeta } from '../src/editor/controls/types'
import { retryOnDetachedTesterFrame } from './harness/detached-tester-frame'

// #954 / #718: the two claims the retry shim rests on, proven in the real browser rather than
// asserted in a comment. The shim's pure decision logic (which errors it claims, how many
// attempts) is covered in apps/admin/test/detached-tester-frame.test.ts under jsdom; what only
// a real browser can show is the second test below — that a RETRIED keyboard press still lands,
// exactly once, on the element the caller focused.
afterEach(cleanup)

const meta = (over: Partial<ControlMeta>): ControlMeta => ({
  name: 'height',
  apiBase: '',
  onPickMedia: () => {},
  ...over
})

describe('browser-harness detached-frame shim (#954)', () => {
  // The shim is installed globally by ./harness/setup.ts, so no spec references it and its
  // absence would be invisible: drop `setupFiles` from vitest.browser.config.ts and every
  // keyboard spec silently goes back to flaking under load, which is the #718 complaint.
  it('is installed on the userEvent singleton every spec imports', () => {
    expect(userEvent.keyboard.name).toBe('keyboardWithDetachedFrameRetry')
  })

  // THE LOAD-BEARING ONE, and precisely scoped: it proves the RETRY PATH, in a real browser —
  // the loop re-runs after a detached-frame rejection, and the re-run still lands its key on the
  // element the caller focused, exactly once.
  //
  // What it does NOT prove is the vendor-ordering claim in ./harness/detached-tester-frame.ts
  // (that `frame.evaluate(focusIframe)` precedes any key dispatch). It cannot: attempt 1 below
  // throws before calling `userEvent.keyboard`, so zero vendor code runs on the failing attempt,
  // and no reordering of vitest internals could change this test's outcome. That claim is
  // source-verified and pinned instead by the version guard in
  // apps/admin/test/detached-tester-frame.test.ts.
  //
  // The guard against a shim that re-ran a HALF-dispatched command is the call COUNT, not the
  // value: `value={200}` is a fixed prop and `onChange` is a spy that never writes back, so
  // every ArrowLeft emits 199 and a double dispatch records [[199],[199]] — verified by probe,
  // never 198. Hence `toEqual([[199]])` on the whole calls array; do NOT relax this to
  // `toHaveBeenLastCalledWith(199)`, which passes for both one press and two.
  it('a retried keypress lands exactly once on the focused element', async () => {
    const onChange = vi.fn()
    render(
      <SliderControl
        value={200}
        onChange={onChange}
        meta={meta({ min: 8, max: 200 })}
      />
    )
    const thumb = page.getByRole('slider')
    ;(thumb.element() as HTMLElement).focus()

    let attempts = 0
    await retryOnDetachedTesterFrame(async () => {
      attempts += 1
      // Simulate exactly what the stale frame handle produces on the first attempt.
      if (attempts === 1) throw new Error('frame.evaluate: Frame was detached')
      await userEvent.keyboard('{ArrowLeft}')
    })

    expect(attempts).toBe(2)
    expect(onChange.mock.calls).toEqual([[199]])
  })
})
