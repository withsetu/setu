import { defineBlock } from '@setu/core'
import { z } from 'zod'

export default defineBlock({
  props: z.object({
    formId: z.string(),
    formLabel: z.string().optional(),
    subject: z.boolean().default(false),
    nameRequired: z.boolean().default(true),
    subjectRequired: z.boolean().default(false),
    messageRequired: z.boolean().default(true),
    successMessage: z.string().default('Thanks — your message has been sent.')
  }),
  editor: {
    label: 'Contact form',
    icon: 'mail',
    group: 'widget',
    keywords: ['form', 'contact', 'email', 'enquiry', 'message']
  }
})
