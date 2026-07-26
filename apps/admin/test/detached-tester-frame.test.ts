import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isDetachedTesterFrame,
  retryOnDetachedTesterFrame
} from '../test-browser/harness/detached-tester-frame'

// #954: the retry shim that keeps @vitest/browser 3.2.7's stale-`vitest-iframe` bug from
// reddening whichever keyboard spec happened to be running (see that module's header for the
// upstream mechanism). Unit-tested in the jsdom project on purpose: the shim wraps the browser
// harness, so it cannot be exercised from inside the harness it is repairing.
//
// KILL-SHOT for this file: drop the `isDetachedTesterFrame` guard from
// retryOnDetachedTesterFrame (retry everything) → "rethrows a product failure on the first
// attempt" fails; drop the retry loop → "retries past one detached-frame rejection" fails.
describe('detached-tester-frame retry shim (#954)', () => {
  // The shim warns on every retry so a real recovery is visible in the browser lane's output;
  // silenced here so this file's deliberate retries don't look like a live harness problem.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('recognises the two shapes the stale frame handle produces', () => {
    expect(
      isDetachedTesterFrame(new Error('frame.evaluate: Frame was detached'))
    ).toBe(true)
    expect(
      isDetachedTesterFrame(
        new Error(
          'Cannot find "vitest-iframe" on the page. This is a bug in Vitest, please report it.'
        )
      )
    ).toBe(true)
    expect(isDetachedTesterFrame('frame.evaluate: Frame was detached')).toBe(
      true
    )
  })

  it('does not claim ordinary product failures', () => {
    expect(
      isDetachedTesterFrame(
        new Error('expected "spy" to be called with arguments: [ 199 ]')
      )
    ).toBe(false)
    expect(isDetachedTesterFrame(new Error('Element not found'))).toBe(false)
    expect(isDetachedTesterFrame(undefined)).toBe(false)
  })

  it('retries past one detached-frame rejection and returns the later value', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('frame.evaluate: Frame was detached'))
      .mockResolvedValueOnce('pressed')

    await expect(retryOnDetachedTesterFrame(fn)).resolves.toBe('pressed')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('rethrows a product failure on the FIRST attempt — never retries it', async () => {
    const productFailure = new Error('onChange was not called with 199')
    const fn = vi.fn<() => Promise<void>>().mockRejectedValue(productFailure)

    await expect(retryOnDetachedTesterFrame(fn)).rejects.toBe(productFailure)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('gives up — and reports the harness error — when every attempt is detached', async () => {
    const detached = new Error('frame.evaluate: Frame was detached')
    const fn = vi.fn<() => Promise<void>>().mockRejectedValue(detached)

    await expect(retryOnDetachedTesterFrame(fn, 3)).rejects.toBe(detached)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('never calls fn a second time when the first attempt succeeds', async () => {
    const fn = vi.fn<() => Promise<number>>().mockResolvedValue(1)
    await expect(retryOnDetachedTesterFrame(fn)).resolves.toBe(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
