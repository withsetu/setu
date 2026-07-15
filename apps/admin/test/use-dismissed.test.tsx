// apps/admin/test/use-dismissed.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useDismissed } from '../src/hooks/use-dismissed'

function Probe({ k, raw }: { k: string; raw?: boolean }) {
  const { dismissed, dismiss } = useDismissed(k, raw ? { raw } : undefined)
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

  it('raw: true uses the key verbatim, outside the setu.dismissed.* namespace', () => {
    // The escape hatch PasswordNudgeBanner needs: #386's agreed design names the exact key
    // `setu.password-nudge-dismissed`, which the default namespacing can't express.
    render(<Probe k="setu.password-nudge-dismissed" raw />)
    fireEvent.click(screen.getByRole('button'))
    expect(localStorage.getItem('setu.password-nudge-dismissed')).toBe('1')
    expect(
      localStorage.getItem('setu.dismissed.setu.password-nudge-dismissed')
    ).toBeNull()
  })

  it('raw: true reads an existing verbatim flag', () => {
    localStorage.setItem('setu.password-nudge-dismissed', '1')
    render(<Probe k="setu.password-nudge-dismissed" raw />)
    expect(screen.getByRole('button')).toHaveTextContent('gone')
  })
})
