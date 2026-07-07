import { describe, it, expect } from 'vitest'
import { selectDistinctForms } from '../../src/submissions/distinct-forms'
import type { Submission } from '../../src/submissions/types'

const sub = (
  formId: string,
  formLabel: string | undefined,
  createdAt: number
): Submission => ({
  id: `${formId}-${createdAt}`,
  formId,
  formLabel,
  fields: {},
  createdAt,
  read: false
})

describe('selectDistinctForms', () => {
  it('groups by formId with counts, newest label wins, sorted by formId', () => {
    const rows: Submission[] = [
      sub('contact', 'Contact', 100),
      sub('contact', 'Contact Us', 200), // newer → label wins
      sub('apply', 'Apply', 150)
    ]
    expect(selectDistinctForms(rows)).toEqual([
      { formId: 'apply', formLabel: 'Apply', count: 1 },
      { formId: 'contact', formLabel: 'Contact Us', count: 2 }
    ])
  })

  it('returns [] for no rows', () => {
    expect(selectDistinctForms([])).toEqual([])
  })
})
