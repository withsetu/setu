import { expect, type Page } from '@playwright/test'

/** Race-free assertions on the admin's notification toasts (#636).
 *
 *  THE PROBLEM. `NotificationProvider` (apps/admin/src/ui/notify.tsx) auto-dismisses every
 *  toast after 4 s. Waiting for one with a normal locator assertion is a bet that the poller
 *  looks while it happens to be on screen, and that bet loses two ways under load: the action
 *  can take longer than the assertion's timeout to toast at all (the slug rename awaits a move
 *  commit plus two reindexes BEFORE toasting), and a contended runner can skip past a 4 s
 *  window entirely. Both land as the same useless message — "element(s) not found" — on a
 *  journey that in fact succeeded, which is exactly what #636 kept doing to CI.
 *
 *  THE FIX. Record toasts as they are inserted, with a MutationObserver installed BEFORE the
 *  triggering action, then assert against the recording. A toast that appeared and dismissed
 *  half an hour ago still counts, so the assertion's timeout can be generous without becoming a
 *  bet on timing: it is waiting for an event to have happened, not for a DOM node to be on
 *  screen at the moment it looks.
 *
 *  CONSTRAINT. The recording lives on `window`, so it does not survive a full document
 *  navigation. Call `watchNotifications` after the last `goto`/reload and before the action —
 *  which is what every caller does. Client-side routing (the rename's `navigate(..., {replace:
 *  true})`) keeps the same document and is unaffected.
 *
 *  Negative assertions ("the toast is gone") still belong on a live locator — see
 *  history-restore.spec.ts's `toBeHidden()` on the first publish toast. */

/** Key on `window` where the in-page recorder parks what it has seen. */
const RECORD_KEY = '__setuRecordedNotifications'

/** Runs IN THE PAGE. Idempotent — a second call on the same document reuses the existing
 *  recording and observer, and returns the length so a later watcher can ignore what was
 *  already there. Toasts are keyed by ELEMENT, not by text, so two actions that produce the
 *  same message are two entries. */
function installRecorder(key: string): number {
  const carrier = window as unknown as Record<string, string[] | undefined>
  const recorded = carrier[key]
  if (recorded) return recorded.length

  const messages: string[] = []
  carrier[key] = messages
  const counted = new WeakSet<Element>()
  const scan = () => {
    const region = document.querySelector(
      '[role="region"][aria-label="Notifications"]'
    )
    if (!region) return
    // notify.tsx renders each toast as role="status" (or role="alert" for errors).
    for (const note of region.querySelectorAll(
      '[role="status"], [role="alert"]'
    )) {
      if (counted.has(note)) continue
      counted.add(note)
      // textContent picks up the trailing "×" of the Dismiss button; the message is the rest.
      messages.push((note.textContent ?? '').replace(/×\s*$/, '').trim())
    }
  }
  scan()
  new MutationObserver(scan).observe(document.body, {
    childList: true,
    subtree: true
  })
  return messages.length
}

export interface NotificationWatch {
  /** Assert that a toast matching `pattern` was rendered at some point AFTER this watch was
   *  created — whether or not it is still on screen. The default timeout is deliberately
   *  generous: it bounds how long the action may take, not how long the toast stays up. */
  expectMatching(pattern: RegExp, options?: { timeout?: number }): Promise<void>
}

/** Start recording notifications on `page` and return a watch scoped to what comes next. */
export async function watchNotifications(
  page: Page
): Promise<NotificationWatch> {
  const alreadyRecorded = await page.evaluate(installRecorder, RECORD_KEY)

  return {
    async expectMatching(pattern, options = {}) {
      await expect
        .poll(
          () =>
            page.evaluate(
              ({ key, from }) =>
                (
                  (window as unknown as Record<string, string[] | undefined>)[
                    key
                  ] ?? []
                ).slice(from),
              { key: RECORD_KEY, from: alreadyRecorded }
            ),
          {
            timeout: options.timeout ?? 30_000,
            message: `expected a notification matching ${String(pattern)}`
          }
        )
        .toContainEqual(expect.stringMatching(pattern))
    }
  }
}
