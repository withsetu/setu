import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  useHasPassword,
  resetHasPasswordStoreForTests
} from '../src/auth/use-has-password'
import { authClient } from '../src/auth/auth-client'

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    listAccounts: vi.fn()
  }
}))

const mockListAccounts = vi.mocked(authClient.listAccounts)

/** Renders the hook's state as text so assertions read like the consumer would. */
function Probe({ enabled, id = '' }: { enabled?: boolean; id?: string }) {
  const { hasPassword, refresh } = useHasPassword(enabled)
  return (
    <div>
      <span data-testid={`state${id}`}>
        {hasPassword === null ? 'unknown' : hasPassword ? 'yes' : 'no'}
      </span>
      <button onClick={() => void refresh()}>refresh{id}</button>
    </div>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  // The store is module-scoped (that's the point of the fix) — reset it or each test would see
  // the previous test's cached answer.
  resetHasPasswordStoreForTests()
})

describe('useHasPassword (#386)', () => {
  it('reports true when a credential account exists', async () => {
    mockListAccounts.mockResolvedValue({
      data: [
        { id: 'a1', providerId: 'credential' },
        { id: 'a2', providerId: 'github' }
      ],
      error: null
    })
    render(<Probe />)
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('yes')
    )
  })

  it('reports false when no credential account exists', async () => {
    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a2', providerId: 'github' }],
      error: null
    })
    render(<Probe />)
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('no')
    )
  })

  it('treats an API error as unknown (null), never as passwordless', async () => {
    mockListAccounts.mockResolvedValue({
      data: null,
      error: { status: 500, message: 'boom' }
    })
    render(<Probe />)
    await waitFor(() => expect(mockListAccounts).toHaveBeenCalled())
    expect(screen.getByTestId('state')).toHaveTextContent('unknown')
  })

  it('treats a thrown/rejected fetch as unknown (null)', async () => {
    mockListAccounts.mockRejectedValue(new Error('network down'))
    render(<Probe />)
    await waitFor(() => expect(mockListAccounts).toHaveBeenCalled())
    expect(screen.getByTestId('state')).toHaveTextContent('unknown')
  })

  it('does not fetch while disabled, then fetches once enabled (lazy)', async () => {
    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a1', providerId: 'credential' }],
      error: null
    })
    const { rerender } = render(<Probe enabled={false} />)
    expect(mockListAccounts).not.toHaveBeenCalled()
    expect(screen.getByTestId('state')).toHaveTextContent('unknown')

    rerender(<Probe enabled />)
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('yes')
    )
  })

  it('refresh() refetches and resolves with the fresh value', async () => {
    mockListAccounts.mockResolvedValue({
      data: [],
      error: null
    })
    render(<Probe />)
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('no')
    )

    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a1', providerId: 'credential' }],
      error: null
    })
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('yes')
    )
    expect(mockListAccounts).toHaveBeenCalledTimes(2)
  })

  it('refresh() on ONE consumer updates EVERY mounted consumer (shared store)', async () => {
    // The PR-review bug: OwnerPasswordCard sets a password and refreshes ITS hook instance, but
    // the always-mounted PasswordNudgeBanner kept its own stale `false` until a full reload.
    mockListAccounts.mockResolvedValue({ data: [], error: null })
    render(
      <>
        <Probe id="-card" />
        <Probe id="-banner" />
      </>
    )
    await waitFor(() =>
      expect(screen.getByTestId('state-card')).toHaveTextContent('no')
    )
    expect(screen.getByTestId('state-banner')).toHaveTextContent('no')

    // Password set → the card's refresh must flip the banner too.
    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a1', providerId: 'credential' }],
      error: null
    })
    fireEvent.click(screen.getByRole('button', { name: 'refresh-card' }))
    await waitFor(() =>
      expect(screen.getByTestId('state-banner')).toHaveTextContent('yes')
    )
    expect(screen.getByTestId('state-card')).toHaveTextContent('yes')
  })

  it('two consumers mounting concurrently share ONE listAccounts fetch (dedup)', async () => {
    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a1', providerId: 'credential' }],
      error: null
    })
    render(
      <>
        <Probe id="-a" />
        <Probe id="-b" />
      </>
    )
    await waitFor(() =>
      expect(screen.getByTestId('state-a')).toHaveTextContent('yes')
    )
    await waitFor(() =>
      expect(screen.getByTestId('state-b')).toHaveTextContent('yes')
    )
    expect(mockListAccounts).toHaveBeenCalledTimes(1)
  })
})
