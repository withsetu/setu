import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FormsSettings } from '../src/screens/settings/FormsSettings'

// #1176: a failed /forms/captcha-status read must be an error with a retry — never rendered as
// "Spam protection: not configured", which is a claim about configuration the admin never read.

const API = 'http://localhost:4444'

function stubStatus(...answers: (() => Promise<Response>)[]) {
  const queue = [...answers]
  const fetchMock = vi.fn(async () => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]!
    return next()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const ok = (body: unknown) => async () =>
  new Response(JSON.stringify(body), { status: 200 })

async function expectError(detail: RegExp) {
  expect(
    await screen.findByText(/couldn.t check spam protection/i)
  ).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(detail)
  expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
}

describe('Settings → Forms → Spam protection status', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a network failure is an error with Try again, not "not configured"', async () => {
    stubStatus(async () => {
      throw new TypeError('Failed to fetch')
    })
    render(<FormsSettings apiBase={API} />)
    await expectError(/didn.t respond/i)
  })

  it('a non-2xx answer names the status', async () => {
    stubStatus(async () => new Response('boom', { status: 500 }))
    render(<FormsSettings apiBase={API} />)
    await expectError(/HTTP 500/)
  })

  it('an unreadable body is an error', async () => {
    stubStatus(async () => new Response('<html>', { status: 200 }))
    render(<FormsSettings apiBase={API} />)
    await expectError(/couldn.t read/i)
  })

  it('a body of the wrong shape is an error', async () => {
    stubStatus(ok({ provider: 42 }))
    render(<FormsSettings apiBase={API} />)
    await expectError(/couldn.t read/i)
  })

  it('Try again re-reads and recovers', async () => {
    const fetchMock = stubStatus(
      async () => {
        throw new TypeError('Failed to fetch')
      },
      ok({ provider: 'turnstile', secretConfigured: true })
    )
    render(<FormsSettings apiBase={API} />)
    await expectError(/didn.t respond/i)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(
      await screen.findByText(/turnstile — secret detected/i)
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a real empty config still says "not configured"', async () => {
    stubStatus(ok({ provider: '', secretConfigured: false }))
    render(<FormsSettings apiBase={API} />)
    expect(
      await screen.findByText('Spam protection: not configured')
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a missing secret says what the server does about it', async () => {
    stubStatus(ok({ provider: 'turnstile', secretConfigured: false }))
    render(<FormsSettings apiBase={API} />)
    expect(await screen.findByText(/secret missing/i)).toBeInTheDocument()
    expect(screen.getByText('SETU_TURNSTILE_SECRET')).toBeInTheDocument()
    expect(
      screen.getByText(/every form submission is rejected/i)
    ).toBeInTheDocument()
  })

  it('shows a checking state, not "not configured", while the read is in flight', () => {
    stubStatus(() => new Promise<Response>(() => {}))
    render(<FormsSettings apiBase={API} />)
    expect(screen.getByText(/checking spam protection/i)).toBeInTheDocument()
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument()
  })
})
