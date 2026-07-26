import { userEvent } from '@vitest/browser/context'
import { retryOnDetachedTesterFrame } from './detached-tester-frame'

// The ONLY setup file the browser project has, and it exists for one reason: to wrap
// `userEvent.keyboard` in the #954 retry shim. See ./detached-tester-frame.ts for the upstream
// bug (@vitest/browser 3.2.7 resolves the tester iframe by name and can hand the keyboard
// command a frame chromium has already detached).
//
// Applied here rather than per spec because the exposure is per-CALL-SITE, not per feature:
// 14 of the 28 spec files in this directory drive `userEvent.keyboard` (13 of 27 before this
// change added one), which is precisely why #718 saw a DIFFERENT keyboard spec fail on each
// run. A helper each spec had to remember to import would leave the next keyboard spec exposed
// and the flake would come back silently.
//
// Deliberately NOT apps/admin/test/setup.ts: that file polyfills jsdom gaps
// (document.elementFromPoint, Range.getClientRects, matchMedia) which real chromium already
// implements, and importing it here would shadow real browser behaviour with stubs — the
// reason vitest.browser.config.ts had no setupFiles at all until now. Nothing below touches
// any browser API; it only re-runs a vitest command whose node-side frame handle went stale.

const originalKeyboard = userEvent.keyboard.bind(userEvent)

// Named so apps/admin/test-browser/harness-detached-frame.test.tsx can prove the wrapper is
// actually in place: if `setupFiles` is ever dropped from vitest.browser.config.ts the keyboard
// specs go back to flaking, and nothing else in the suite would notice.
//
// Variadic, NOT `(text: string)`. TypeScript accepts a narrower-arity function wherever a wider
// one is expected, so a vitest release that added `keyboard(text, options)` would type-check
// here and SILENTLY drop `options` for all 14 keyboard specs. Forwarding `Parameters<…>` keeps
// the wrapper honest against a signature change instead of swallowing one.
async function keyboardWithDetachedFrameRetry(
  ...args: Parameters<typeof userEvent.keyboard>
): Promise<void> {
  await retryOnDetachedTesterFrame(() => originalKeyboard(...args))
}

userEvent.keyboard = keyboardWithDetachedFrameRetry
