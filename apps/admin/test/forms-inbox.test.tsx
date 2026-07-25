import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { SubmissionPort } from '@setu/core'
import {
  createMemoryDataPort,
  createMemorySubmissionPort
} from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { SubmissionApiError } from '@setu/submission-http'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { NotificationProvider } from '../src/ui/notify'
import { FormsInbox } from '../src/screens/FormsInbox'

beforeAll(() => {
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.scrollIntoView
  ) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

afterEach(() => vi.restoreAllMocks())

/** A SubmissionPort whose listSubmissions rejects until healed. */
function brokenSubmissions(): { port: SubmissionPort; heal: () => void } {
  const inner = createMemorySubmissionPort([])
  let healthy = false
  const port: SubmissionPort = {
    ...inner,
    listSubmissions: (filter) =>
      healthy
        ? inner.listSubmissions(filter)
        : Promise.reject(new Error('submissions unavailable')),
    distinctForms: () => (healthy ? inner.distinctForms() : Promise.resolve([]))
  }
  return {
    port,
    heal: () => {
      healthy = true
    }
  }
}

/** A SubmissionPort whose list load always rejects with `err`. */
function refusingSubmissions(err: Error): SubmissionPort {
  const inner = createMemorySubmissionPort([])
  return {
    ...inner,
    listSubmissions: () => Promise.reject(err),
    distinctForms: () => Promise.resolve([])
  }
}

function renderInbox(submissions: SubmissionPort) {
  const services = servicesFor(
    createMemoryDataPort([]),
    createMemoryGitPort([]),
    undefined,
    undefined,
    submissions
  )
  const wrapper = (children: ReactNode) => (
    <MemoryRouter>
      <NotificationProvider>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </NotificationProvider>
    </MemoryRouter>
  )
  render(wrapper(<FormsInbox />))
}

describe('FormsInbox: a failed list load', () => {
  it('replaces the eternal "Loading…" with a retryable error, then recovers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { port, heal } = brokenSubmissions()
    renderInbox(port)

    const retry = await screen.findByRole('button', { name: /try again/i })
    // Not parked on "Loading…" forever (#835)…
    expect(screen.queryByText(/^loading…$/i)).toBeNull()
    // …and not the empty state either (that would be a lie).
    expect(screen.queryByText(/no submissions/i)).toBeNull()

    heal()
    fireEvent.click(retry)
    await waitFor(() =>
      expect(screen.getByText(/no submissions/i)).toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  // #912: createHttpSubmissionAdapter throws SubmissionApiError for EVERY non-2xx,
  // so before this the 403 below reached the user as "Check your connection and try
  // again" — the class shipped in #899 was read nowhere.
  it('shows the server reason for a refused list load, not a connection message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderInbox(refusingSubmissions(new SubmissionApiError(403, 'forbidden')))

    // Both the in-place panel and the toast say the same true thing.
    await screen.findByRole('button', { name: /try again/i })
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(2)
    for (const alert of alerts) {
      expect(alert).toHaveTextContent(/permission/i)
      expect(alert).not.toHaveTextContent(/connection/i)
    }
  })

  it('still says "check your connection" when nothing answered', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // The inversion #834 warns about: a real transport failure must NOT be dressed
    // up as a server refusal.
    renderInbox(refusingSubmissions(new TypeError('Failed to fetch')))

    await screen.findByRole('button', { name: /try again/i })
    for (const alert of screen.getAllByRole('alert'))
      expect(alert).toHaveTextContent(/check your connection/i)
  })
})

describe('FormsInbox: a refused action', () => {
  /** Render an inbox holding one submission, whose mutations reject with `err`. */
  const renderWithFailingMutations = async (
    err: Error
  ): Promise<SubmissionPort> => {
    const inner = createMemorySubmissionPort([
      { formId: 'contact', fields: { email: 'visitor@example.test' } }
    ])
    const port: SubmissionPort = {
      ...inner,
      setRead: () => Promise.reject(err),
      deleteSubmissions: () => Promise.reject(err)
    }
    renderInbox(port)
    await screen.findByText('visitor@example.test')
    return port
  }

  const lastAlert = async (pattern: RegExp): Promise<void> => {
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert')
      expect(alerts[alerts.length - 1]).toHaveTextContent(pattern)
    })
  }

  it('reports a 403 on mark-read as a permission problem', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderWithFailingMutations(new SubmissionApiError(403, 'forbidden'))
    fireEvent.click(screen.getByRole('button', { name: /^read$/i }))
    await lastAlert(/permission/i)
    expect(screen.queryByText(/check your connection/i)).toBeNull()
  })

  it('reports a 413 on delete as a size problem, naming the action', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderWithFailingMutations(new SubmissionApiError(413, 'too_large'))
    fireEvent.click(
      screen.getByRole('checkbox', { name: /select submission/i })
    )
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    // Confirm in the AlertDialog.
    const confirm = await screen.findAllByRole('button', { name: /^delete$/i })
    fireEvent.click(confirm[confirm.length - 1]!)
    await lastAlert(/delete the submissions/i)
    await lastAlert(/too much at once/i)
  })

  it('still reports a transport failure as a connection problem', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderWithFailingMutations(new TypeError('Failed to fetch'))
    fireEvent.click(screen.getByRole('button', { name: /^read$/i }))
    await lastAlert(/check your connection/i)
  })
})
