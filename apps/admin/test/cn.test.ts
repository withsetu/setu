import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('merges conditional classes', () => {
    expect(cn('p-2', false && 'hidden', 'text-sm')).toBe('p-2 text-sm')
  })
  it('de-dupes conflicting tailwind utilities (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
})
