import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from 'vitest/browser'
import { PASSWORD_RESET_EMAIL, type EmailTemplateOverrides } from '@setu/core'
import { EmailTemplates } from '../src/screens/settings/EmailTemplates'

// ---------------------------------------------------------------------------------
// #940 — the token palette's two REAL-FOCUS paths, neither of which jsdom can reach.
//
// `EmailTemplates.targetField` picks the field a palette chip writes into from two
// signals: `document.activeElement`, then the last field that fired `onFocus`. The
// jsdom suite (apps/admin/test/email-templates.test.tsx) can only ever exercise the
// FIRST: `fireEvent.blur` dispatches an event without moving `document.activeElement`,
// so the element stays active and the second signal is unreachable there. And
// `fireEvent.click` never dispatches `mousedown`, so the chip's `onMouseDown`
// preventDefault — the guard that keeps the field focused across a palette click — is
// executed by no jsdom test at all.
//
// Both need a real browser: real focus moves, and a real mouse press whose DEFAULT
// ACTION (focus-follows-mousedown) only happens for a trusted event, so it cannot be
// reproduced by dispatching a synthetic MouseEvent either.
//
// What this file measured on chromium 1280x800 while it was written, because it is not
// what #940 predicted and the next reader will otherwise re-derive it:
//   * chromium PRESERVES `selectionStart` across blur (TextControlElement caches the
//     selection), so the caret survives losing focus on its own; and
//   * `focused` (signal 2) already resolves a chip click to the right field once focus
//     has moved to the chip.
// Together those mean deleting the `onMouseDown` preventDefault leaves the INSERTED
// TEXT byte-identical — the two mechanisms are redundant for the outcome. The property
// that is uniquely the preventDefault's, and the one asserted below, is that the field
// the admin is editing NEVER LOSES FOCUS across a palette click (blur count 0 with the
// guard, 1 without).
// ---------------------------------------------------------------------------------

afterEach(cleanup)

/** Controlled wrapper — `EmailTemplates` is fully controlled, and the insertion is only
 *  observable once the new overrides flow back in as props (the same shape EmailSettings
 *  gives it). Rendered directly rather than through EmailSettings so nothing here depends
 *  on the /api/email/status fetch. */
function Harness() {
  const [overrides, setOverrides] = useState<EmailTemplateOverrides>({})
  return (
    <EmailTemplates overrides={overrides} errors={{}} onChange={setOverrides} />
  )
}

const card = () =>
  page.getByRole('region', { name: PASSWORD_RESET_EMAIL.label })
const subjectEl = () =>
  card().getByLabelText('Subject').element() as HTMLInputElement
const bodyEl = () =>
  card().getByLabelText('Body (HTML)').element() as HTMLTextAreaElement
const chipEl = (token: string) =>
  card()
    .getByRole('button', { name: new RegExp(`insert .*${token}`, 'i') })
    .element() as HTMLButtonElement

/** Caret 5 characters into the shipped subject — "Reset|·your·Setu·password". Mid-string
 *  on purpose: appending at the end would land at index 25, so the assertion below
 *  distinguishes "honored the caret" from "appended". */
const CARET = 5
const subjectWith = (snippet: string): string =>
  PASSWORD_RESET_EMAIL.defaultSubject.slice(0, CARET) +
  snippet +
  PASSWORD_RESET_EMAIL.defaultSubject.slice(CARET)

describe('email token palette (real browser)', () => {
  // Signal 2. Focus reaches a chip WITHOUT passing through another field — a screen
  // reader's next-button quick-nav, or any programmatic focus move. (Plain Tab from the
  // Subject cannot produce this state: the Body sits between them in DOM order, so it
  // fires its own onFocus on the way and the Body then legitimately becomes the target.)
  // `document.activeElement` is the chip at activation time, so only the remembered
  // field can name the Subject — which is why the assertion below is preceded by an
  // explicit check that focus really did move off the input.
  it('inserts into the field the admin was editing when Enter activates a chip that now holds focus', async () => {
    render(<Harness />)
    await card().getByLabelText('Subject').click()
    const subject = subjectEl()
    expect(document.activeElement).toBe(subject)
    subject.setSelectionRange(CARET, CARET)

    const chip = chipEl('reset_url')
    chip.focus()
    // Load-bearing: without a REAL focus move this would just be re-testing signal 1.
    expect(document.activeElement).toBe(chip)

    await userEvent.keyboard('{Enter}')

    await expect
      .element(card().getByLabelText('Subject'))
      .toHaveValue(subjectWith('{{reset_url}}'))
    // ...and nothing leaked into the Body, which is where the default arm would have put it.
    expect(bodyEl().value).toBe(PASSWORD_RESET_EMAIL.defaultHtml)
  })

  // The `onMouseDown` preventDefault. A real click dispatches a trusted mousedown whose
  // default action moves focus to the button; preventing it is what keeps the caret
  // visible and the field's focus ring where the admin left it. See the header note on
  // why the inserted TEXT alone cannot kill-shot this: the blur count is the observable
  // that only this guard controls.
  it('keeps focus on the edited field through a real mouse click on a chip, inserting at the caret', async () => {
    render(<Harness />)
    await card().getByLabelText('Subject').click()
    const subject = subjectEl()
    subject.setSelectionRange(CARET, CARET)

    let blurs = 0
    subject.addEventListener('blur', () => {
      blurs += 1
    })

    // A real (CDP-driven) click: mousedown → mouseup → click, trusted, so the chip's
    // preventDefault actually suppresses the focus shift. `fireEvent.click` in jsdom
    // dispatches none of that.
    await userEvent.click(
      card().getByRole('button', { name: /insert .*reset_url/i })
    )

    expect(blurs).toBe(0)
    expect(document.activeElement).toBe(subjectEl())
    await expect
      .element(card().getByLabelText('Subject'))
      .toHaveValue(subjectWith('{{reset_url}}'))
    // Caret parked after the inserted token so typing continues naturally.
    expect(subjectEl().selectionStart).toBe(CARET + '{{reset_url}}'.length)
    expect(bodyEl().value).toBe(PASSWORD_RESET_EMAIL.defaultHtml)
  })
})
