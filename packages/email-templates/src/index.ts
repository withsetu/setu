import { render } from '@react-email/render'
import type { Submission, NotificationContent } from '@setu/core'
import { SubmissionNotification } from './SubmissionNotification.js'
import React from 'react'

/** Render the submission-notification email to HTML + plaintext. */
export async function renderSubmissionEmail(submission: Submission): Promise<NotificationContent> {
  const el = React.createElement(SubmissionNotification, { submission })
  const html = await render(el)
  const text = await render(el, { plainText: true })
  return {
    subject: `New submission: ${submission.formLabel ?? submission.formId}`,
    html,
    text,
  }
}
