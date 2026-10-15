import { defineBlock } from '@setu/core'
import { z } from 'zod'

// Visitor-facing text is optional: unset (or blank) renders CONTACT_DEFAULT_TEXT from
// @setu/core, so a page in another language sets only what it needs (#1248). The block
// keeps its own in-canvas settings popover (it is not inspector-driven), where these appear
// under "Text"; the labels below name them for any other surface that reads the contract.
const text = z.string().optional()

export default defineBlock({
  props: z.object({
    formId: z.string(),
    formLabel: z.string().optional(),
    subject: z.boolean().default(false),
    nameRequired: z.boolean().default(true),
    subjectRequired: z.boolean().default(false),
    messageRequired: z.boolean().default(true),
    successMessage: z.string().default('Thanks — your message has been sent.'),
    nameLabel: text,
    emailLabel: text,
    subjectLabel: text,
    messageLabel: text,
    submitLabel: text,
    errorMessage: text
  }),
  editor: {
    label: 'Contact form',
    icon: 'mail',
    group: 'widget',
    keywords: ['form', 'contact', 'email', 'enquiry', 'message'],
    labels: {
      formLabel: 'Form name',
      nameLabel: 'Name label',
      emailLabel: 'Email label',
      subjectLabel: 'Subject label',
      messageLabel: 'Message label',
      submitLabel: 'Button text',
      successMessage: 'Success message',
      errorMessage: 'Error message'
    },
    groups: [
      {
        id: 'fields',
        label: 'Fields',
        controls: [
          'formLabel',
          'subject',
          'nameRequired',
          'subjectRequired',
          'messageRequired'
        ]
      },
      {
        id: 'text',
        label: 'Text',
        controls: [
          'nameLabel',
          'emailLabel',
          'subjectLabel',
          'messageLabel',
          'submitLabel',
          'successMessage',
          'errorMessage'
        ]
      }
    ]
  }
})
