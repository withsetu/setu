import { describe, it, expect } from 'vitest'
import { submissionsToCsv } from '../../src/submissions/csv'
import type { Submission } from '../../src/submissions/types'

const row = (over: Partial<Submission>): Submission => ({
  id: 'id1',
  formId: 'contact',
  formLabel: 'Contact',
  fields: { name: 'Ada', email: 'ada@x.com', message: 'hi' },
  createdAt: 0,
  read: false,
  ...over
})

describe('submissionsToCsv', () => {
  it('emits a header + one row per submission with field columns', () => {
    const csv = submissionsToCsv([row({})])
    const [header, line] = csv.trim().split('\n')
    expect(header).toBe('id,date,formId,formLabel,read,email,message,name')
    expect(line).toContain('ada@x.com')
  })

  it('escapes commas, quotes, and newlines', () => {
    const csv = submissionsToCsv([
      row({
        fields: { name: 'a,b', email: 'x@y.com', message: 'he said "hi"\nbye' }
      })
    ])
    expect(csv).toContain('"a,b"')
    expect(csv).toContain('"he said ""hi""\nbye"')
  })

  it('returns just a header for no rows', () => {
    expect(submissionsToCsv([]).trim().split('\n')).toHaveLength(1)
  })

  it('neutralizes spreadsheet formula injection by prefixing a single quote', () => {
    const csv = submissionsToCsv([
      row({
        fields: {
          name: '=HYPERLINK("http://evil")',
          email: 'x@y.com',
          message: 'hi'
        }
      })
    ])
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`)
  })
})
