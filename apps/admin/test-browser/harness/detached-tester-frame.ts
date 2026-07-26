// Retry shim for ONE upstream bug in @vitest/browser 3.2.7's playwright provider (#954,
// the shared cause behind #718's "a different browser-mode keyboard test failed on each
// run"). Nothing here is about the app; it is harness plumbing only.
//
// THE BUG. `userEvent.keyboard(...)` is the only interactivity API in this suite that
// resolves the tester iframe by NAME on the node side. `getCommandsContext` (@vitest/browser
// 3.2.7, dist/webdriver-BStCVush.js) returns:
//
//     frame() {
//       return new Promise((resolve, reject) => {
//         const frame = page.frame("vitest-iframe")
//         if (frame) return resolve(frame)          // ← never checks frame.isDetached()
//         const timeout = setTimeout(() => reject(new Error(
//           `Cannot find "vitest-iframe" on the page. This is a bug in Vitest, please report it.`
//         )), 1e3).unref()
//         page.on("frameattached", (frame) => { clearTimeout(timeout); resolve(frame) })
//       })
//     }
//
// Neither branch is safe: the first can hand back a frame Chromium has already detached,
// and the second resolves with WHATEVER frame attaches next, regardless of its name. The
// `keyboard` command's first statement is then `await frame.evaluate(focusIframe)`, which
// throws `frame.evaluate: Frame was detached` — attributed to the test's `userEvent.keyboard`
// line, so it reads as a product failure. Vitest's own message in the sibling branch already
// calls this a bug in Vitest; upstream has since fixed a related orchestrator iframe leak
// (vitest-dev/vitest#10300, merged 2026-05-08, i.e. after 3.2.7).
//
// Locator-based APIs (`expect.element`, `locator.click`) go through
// `page.frameLocator('[data-vitest="true"]')`, which re-resolves and auto-waits on every use
// — which is exactly why only the keyboard specs ever showed this, and why widening a
// timeout would have done nothing: the frame handle is already wrong when the command starts.
//
// WHY A RETRY IS SAFE HERE, i.e. cannot double-apply keys: in 3.2.7 the failing
// `frame.evaluate(focusIframe)` is the FIRST statement of the `keyboard` command, strictly
// before `keyboardImplementation` dispatches anything, and the command's only other
// `frame.evaluate` sits in the `{selectall}` branch this repo never uses. So a detached-frame
// rejection means zero keys reached the browser and the DOM focus set by the caller (which
// lives in the live frame, not the stale handle) is untouched.
//
// That last paragraph is a claim about vendor internals, so it is pinned by a test rather than
// left to be re-read on trust: apps/admin/test-browser/harness-detached-frame.test.tsx forces a
// detached-frame rejection ahead of a real ArrowLeft on a real Radix slider and asserts the
// retried press lands EXACTLY ONCE (199, not 198) on the still-focused thumb. If a vitest bump
// ever moves key dispatch ahead of the focusIframe call, that test is what fails.
//
// Which errors this claims, and how many attempts it makes, are enforced by
// apps/admin/test/detached-tester-frame.test.ts.

/** Matches ONLY the stale-`vitest-iframe` failure class described above — never a product error. */
export function isDetachedTesterFrame(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  return (
    /Frame was detached/i.test(message) ||
    /Cannot find "vitest-iframe" on the page/i.test(message)
  )
}

/**
 * Runs `fn`, re-running it on a detached-tester-frame rejection so a stale frame handle costs
 * a retry instead of a red build. Any other rejection propagates on the FIRST attempt — this
 * must never soften a real failure into a slow one.
 *
 * `attempts` is deliberately small: the retry exists to outlive one bad frame handle, and a
 * genuinely wedged harness should still fail the run rather than spin.
 */
export async function retryOnDetachedTesterFrame<T>(
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      if (!isDetachedTesterFrame(error)) throw error
      lastError = error
      // Loud on purpose. A silent retry would make this module indistinguishable from dead
      // code, and #718's whole complaint was that a flake nobody can see becomes "re-run it".
      // If this line stops appearing after a vitest bump, the shim is no longer needed.
      console.warn(
        `[#954] retrying a browser command past a detached vitest-iframe (attempt ${attempt}/${attempts})`
      )
    }
  }
  throw lastError
}
