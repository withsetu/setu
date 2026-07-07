import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('merges conditional classes', () => {
    // Declared boolean (not a literal) so the conditional is real to the linter too.
    const hidden: boolean = false
    expect(cn('p-2', hidden && 'hidden', 'text-sm')).toBe('p-2 text-sm')
  })
  it('de-dupes conflicting tailwind utilities (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
})
