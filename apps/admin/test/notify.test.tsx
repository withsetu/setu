import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NotificationProvider, useNotify } from '../src/ui/notify'

function Trigger() {
  const notify = useNotify()
  return <button onClick={() => notify.success('Saved 3 posts')}>go</button>
}

describe('useNotify', () => {
  it('shows a dismissible success notification', async () => {
    render(
      <NotificationProvider>
        <Trigger />
      </NotificationProvider>
    )
    fireEvent.click(screen.getByText('go'))
    expect(await screen.findByText('Saved 3 posts')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    await waitFor(() => expect(screen.queryByText('Saved 3 posts')).toBeNull())
  })

  it('throws when used outside the provider', () => {
    function Bare() {
      useNotify()
      return null
    }
    expect(() => render(<Bare />)).toThrow(/NotificationProvider/)
  })
})
