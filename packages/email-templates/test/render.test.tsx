import { describe, it, expect } from 'vitest'
import { renderSubmissionEmail } from '../src/index'
import type { Submission } from '@setu/core'

const sub: Submission = {
  id: 'x',
  formId: 'contact',
  formLabel: 'Contact',
  fields: { name: 'Ada', email: 'ada@x.com', message: 'hello world' },
  createdAt: 0,
  read: false,
}

describe('renderSubmissionEmail', () => {
  it('renders subject + html containing the field values', async () => {
    const out = await renderSubmissionEmail(sub)
    expect(out.subject).toContain('Contact')
    expect(out.html).toContain('ada@x.com')
    expect(out.html).toContain('hello world')
    expect(out.text).toBeTypeOf('string')
  })
})
