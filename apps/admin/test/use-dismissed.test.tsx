// apps/admin/test/use-dismissed.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useDismissed } from '../src/dashboard/use-dismissed'

function Probe({ k }: { k: string }) {
  const { dismissed, dismiss } = useDismissed(k)
  return <button onClick={dismiss}>{dismissed ? 'gone' : 'visible'}</button>
}

describe('useDismissed', () => {
  beforeEach(() => localStorage.clear())

  it('starts visible and persists dismissal', () => {
    render(<Probe k="tips" />)
    expect(screen.getByRole('button')).toHaveTextContent('visible')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('gone')
    expect(localStorage.getItem('setu.dismissed.tips')).toBe('1')
  })

  it('reads an existing dismissed flag', () => {
    localStorage.setItem('setu.dismissed.tips', '1')
    render(<Probe k="tips" />)
    expect(screen.getByRole('button')).toHaveTextContent('gone')
  })
})
