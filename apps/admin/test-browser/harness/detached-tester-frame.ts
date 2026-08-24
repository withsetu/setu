// Retry shim for ONE upstream bug in the vitest playwright provider (#954, the shared cause
// behind #718's "a different browser-mode keyboard test failed on each run"). Nothing here is
// about the app; it is harness plumbing only.
//
// STILL PRESENT ON VITEST 4 (#949). The provider moved package — vitest 4 split it out of
// `@vitest/browser` into `@vitest/browser-playwright` — and the resolver below came across
// byte-for-byte: same name lookup, same missing `isDetached()`, same `frameattached`
// fallback. That is asserted, not assumed: apps/admin/test/detached-tester-frame.test.ts
// pins the provider version AND greps its dist for both halves of the defect, so the day
// upstream fixes it this shim fails loudly instead of lingering.
//
// THE BUG. `userEvent.keyboard(...)` is the only interactivity API in this suite that
// resolves the tester iframe by NAME on the node side. The commands context
// (@vitest/browser-playwright 4.1.11, dist/index.js:1118-1134) returns:
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
// calls this a bug in Vitest.
//
// UPSTREAM IS NOT FIXED. vitest-dev/vitest#10300 ("fix iframe leak in the orchestrator") is
// the nearest attempt and it was **closed UNMERGED** on 2026-05-08 by its own author, who
// concluded: "this doesn't fully fix the issue — only a force-GC every 5s hack works, but any
// fix on the JS side doesn't, so it seems like this might be a bug or a race condition on the
// browser level" (GitHub API: `merged: false`, `merged_at: null`). So do NOT read a vitest bump
// as automatically making this module removable — the retry is expected to be needed until
// something upstream actually lands. The version guard below is what forces that re-check.
//
// Locator-based APIs (`expect.element`, `locator.click`) go through
// `page.frameLocator('[data-vitest="true"]')` (same file, the `iframe` getter at line 1134),
// which re-resolves and auto-waits on every use — which is exactly why only the keyboard specs
// ever showed this, and why widening a timeout would have done nothing: the frame handle is
// already wrong when the command starts.
//
// WHY A RETRY CANNOT DOUBLE-APPLY KEYS. In 4.1.11 the failing `frame.evaluate(focusIframe)` is
// the FIRST statement of the `keyboard` command (dist/index.js:213-223), strictly before
// `keyboardImplementation` dispatches anything, and `keyboardImplementation` itself never
// touches a frame handle. `context.frame()` has exactly three call sites, none of them on a
// path this suite takes twice: the `keyboard` command's focusIframe, its `{selectall}` branch,
// and `dragAndDrop` — and this suite uses no `{selectall}`, no dragAndDrop and no clipboard
// ops. So a detached-frame rejection means zero keys reached the browser, and the DOM focus the
// caller set (which lives in the live frame, not the stale handle) is untouched.
//
// That paragraph is SOURCE-VERIFIED, not behaviour-verified — no test can observe vendor
// statement order — so it is pinned the only way it can be: the version guard in
// apps/admin/test/detached-tester-frame.test.ts asserts the installed
// @vitest/browser-playwright is exactly 4.1.11 AND greps its dist for that ordering, so a bump
// fails LOUDLY and forces a re-read instead of silently invalidating the paragraph.
//
// The retry BEHAVIOUR (loop runs, one keypress still lands, exactly once) is proven in a real
// browser by apps/admin/test-browser/harness-detached-frame.test.tsx; which errors this claims
// and how many attempts it makes are enforced by apps/admin/test/detached-tester-frame.test.ts.

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
