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
})
