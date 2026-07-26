import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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

// The shim rests on two facts about a VENDORED file, and nothing else in this repo would notice
// either of them changing. The retry never fired in ~30 measured suite runs, so "no warning in
// the log" cannot distinguish "upstream fixed it" from "our error-string matcher stopped
// matching" from "the race simply didn't recur" — and the string matcher can't self-detect
// wording drift, because the tests above author the very strings they assert on.
//
// So pin the vendor instead. These two fail LOUDLY on a bump and force a human re-read of
// ../test-browser/harness/detached-tester-frame.ts before the shim is trusted or deleted.
// Note vitest-dev/vitest#10300 was closed UNMERGED, so a newer vitest is NOT evidence of a fix.
describe('the vendor facts the shim rests on (#954)', () => {
  const require = createRequire(import.meta.url)
  const pkg = JSON.parse(
    readFileSync(require.resolve('@vitest/browser/package.json'), 'utf8')
  ) as { version: string }

  it('is pinned to the @vitest/browser this shim was verified against', () => {
    expect(
      pkg.version,
      'a @vitest/browser bump invalidates the source-verified claims in detached-tester-frame.ts — re-read them, re-check vitest-dev/vitest#10300, then move this pin'
    ).toBe('3.2.7')
  })

  it('still dispatches keys only AFTER the focusIframe evaluate — the no-double-apply claim', () => {
    // `@vitest/browser`'s main entry is the dist file carrying the `keyboard` command.
    const dist = readFileSync(require.resolve('@vitest/browser'), 'utf8')
    const start = dist.indexOf(
      'const keyboard = async (context, text, state) =>'
    )
    expect(start, 'the keyboard command moved or was renamed').toBeGreaterThan(
      -1
    )
    const body = dist.slice(start, start + 1200)

    const focusIframeAt = body.indexOf('frame.evaluate(focusIframe)')
    const dispatchAt = body.indexOf('keyboardImplementation(')
    expect(focusIframeAt, 'focusIframe evaluate not found').toBeGreaterThan(-1)
    expect(dispatchAt, 'keyboardImplementation call not found').toBeGreaterThan(
      -1
    )
    expect(
      focusIframeAt,
      'key dispatch now precedes the frame handle: a retry could double-apply keys, so the shim must be re-thought'
    ).toBeLessThan(dispatchAt)
  })
})
