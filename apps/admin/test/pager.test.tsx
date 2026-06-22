import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Pager } from '../src/screens/content-list/Pager'

describe('Pager', () => {
  it('shows range and pages forward', () => {
    const onPage = vi.fn()
    render(<Pager from={1} to={25} total={128} page={0} onPage={onPage} />)
    expect(screen.getByText('1–25 of 128')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPage).toHaveBeenCalledWith(1)
  })
})
