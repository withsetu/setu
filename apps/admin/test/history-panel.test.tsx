import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within
} from '@testing-library/react'
import { NotificationProvider } from '../src/ui/notify'
import { HistoryPanel } from '../src/editor/HistoryPanel'

const PATH = 'content/post/en/hello.mdoc'
const SHA_HEAD = 'a'.repeat(40)
const SHA_OLD = 'b'.repeat(40)

const ENTRIES = [
  {
    sha: SHA_HEAD,
    author: 'E2E Admin',
    email: 'admin@setu.test',
    date: new Date(Date.now() - 60_000).toISOString(),
    subject: 'Publish post/en/hello'
  },
  {
    sha: SHA_OLD,
    author: 'E2E Author',
    email: 'author@setu.test',
    date: new Date(Date.now() - 3_600_000).toISOString(),
    subject: 'Save draft post/en/hello'
  }
]

const HEAD_CONTENT = '---\ntitle: New Title\n---\nThe slow brown fox.'
const OLD_CONTENT = '---\ntitle: Old Title\n---\nThe quick brown fox.'
/** A live editor buffer that differs from HEAD — the owner-UAT dirty state. */
const DIRTY_CONTENT = '---\ntitle: New Title\n---\nThe slow red fox.'

/** Stub global fetch (apiFetch's primitive — the users-screen.test.tsx pattern)
 *  for the three history routes the panel calls. */
function stubHistoryFetch(opts?: {
  entries?: typeof ENTRIES
  restoreStatus?: number
  onRestoreBody?: (body: unknown) => void
  /** Override the content served for the OLD (non-HEAD) revision. */
  oldContent?: string
}) {
  const entries = opts?.entries ?? ENTRIES
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = url
      if (u.includes('/api/history/restore')) {
        opts?.onRestoreBody?.(JSON.parse(init?.body as string))
        const status = opts?.restoreStatus ?? 200
        const body =
          status === 200 ? { sha: 'c'.repeat(40) } : { error: 'forbidden' }
        return new Response(JSON.stringify(body), { status })
      }
      if (u.includes('/api/history/file')) {
        const sha = new URL(u, 'http://x').searchParams.get('sha')
        const content =
          sha === SHA_HEAD ? HEAD_CONTENT : (opts?.oldContent ?? OLD_CONTENT)
        return new Response(JSON.stringify({ content }), { status: 200 })
      }
      if (u.includes('/api/history')) {
        return new Response(JSON.stringify({ entries }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })
  )
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof HistoryPanel>> = {}
) {
  const onOpenChange = vi.fn()
  const onRestored = vi.fn()
  const utils = render(
    <NotificationProvider>
      <HistoryPanel
        open
        onOpenChange={onOpenChange}
        path={PATH}
        apiBase=""
        onRestored={onRestored}
        // Default: a clean buffer (serializes to exactly the HEAD content).
        getEditorContent={() => HEAD_CONTENT}
        {...props}
      />
    </NotificationProvider>
  )
  return { ...utils, onOpenChange, onRestored }
}

afterEach(() => vi.unstubAllGlobals())

describe('HistoryPanel (#466)', () => {
  it('lists revisions newest-first: author, relative date, subject, Current badge', async () => {
    stubHistoryFetch()
    renderPanel()

    const list = await screen.findByRole('list', { name: 'Revisions' })
    const rows = await within(list).findAllByRole('button')
    expect(rows).toHaveLength(2)
    expect(list).toHaveTextContent('E2E Admin')
    expect(list).toHaveTextContent('E2E Author')
    expect(list).toHaveTextContent('Publish post/en/hello')
    expect(list).toHaveTextContent('Save draft post/en/hello')
    // The HEAD row (first) is labeled Current.
    expect(rows[0]).toHaveTextContent('Current')
    expect(rows[1]).not.toHaveTextContent('Current')
    // Relative dates via lib/format's relativeTime.
    expect(rows[0]).toHaveTextContent('1m ago')
    expect(rows[1]).toHaveTextContent('1h ago')
  })

  it('single-revision entries get the empty state', async () => {
    stubHistoryFetch({ entries: [ENTRIES[0]!] })
    renderPanel()

    await screen.findByRole('list', { name: 'Revisions' })
    expect(
      await screen.findByText(/Only one revision so far/)
    ).toBeInTheDocument()
  })

  it('selecting a revision renders the diff: field rows + word-level body marks', async () => {
    stubHistoryFetch()
    renderPanel()

    const list = await screen.findByRole('list', { name: 'Revisions' })
    const rows = await within(list).findAllByRole('button')
    fireEvent.click(rows[1]!)

    const changes = await screen.findByRole('region', { name: 'Changes' })
    // Frontmatter field row: old → new.
    await waitFor(() => expect(changes).toHaveTextContent('title'))
    expect(changes).toHaveTextContent('Old Title')
    expect(changes).toHaveTextContent('New Title')
    // Body word diff: <del> for the revision's word, <ins> for the current one.
    const removed = await screen.findByText('quick')
    expect(removed.tagName).toBe('DEL')
    const added = screen.getByText('slow')
    expect(added.tagName).toBe('INS')
  })

  it('restore: confirm dialog → POST {path, sha} → success toast, close, onRestored', async () => {
    let restoreBody: unknown
    stubHistoryFetch({ onRestoreBody: (b) => (restoreBody = b) })
    const { onOpenChange, onRestored } = renderPanel()

    const list = await screen.findByRole('list', { name: 'Revisions' })
    const rows = await within(list).findAllByRole('button')
    fireEvent.click(rows[1]!)

    const restore = await screen.findByRole('button', {
      name: 'Restore this revision'
    })
    await waitFor(() => expect(restore).toBeEnabled())
    fireEvent.click(restore)

    // AlertDialog confirm with the never-rewrites promise. The buffer is
    // clean, so the discard warning must NOT appear.
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/new commit/)
    expect(dialog).toHaveTextContent(/never rewritten/)
    expect(dialog).not.toHaveTextContent(/discards your unsaved changes/)
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() =>
      expect(restoreBody).toEqual({ path: PATH, sha: SHA_OLD })
    )
    expect(await screen.findByText(/Restored ·/)).toBeInTheDocument()
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith('c'.repeat(40)))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('restore 403 surfaces an honest permission error toast', async () => {
    stubHistoryFetch({ restoreStatus: 403 })
    const { onRestored } = renderPanel()

    const list = await screen.findByRole('list', { name: 'Revisions' })
    const rows = await within(list).findAllByRole('button')
    fireEvent.click(rows[1]!)
    const restore = await screen.findByRole('button', {
      name: 'Restore this revision'
    })
    await waitFor(() => expect(restore).toBeEnabled())
    fireEvent.click(restore)
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }))

    expect(await screen.findByText(/permission to restore/)).toBeInTheDocument()
    expect(onRestored).not.toHaveBeenCalled()
  })

  it('the Current revision cannot be restored (disabled with reason)', async () => {
    stubHistoryFetch()
    renderPanel()

    const list = await screen.findByRole('list', { name: 'Revisions' })
    const rows = await within(list).findAllByRole('button')
    fireEvent.click(rows[0]!)

    const restore = await screen.findByRole('button', {
      name: 'Restore this revision'
    })
    expect(restore).toBeDisabled()
    expect(screen.getByText(/already the current revision/)).toBeInTheDocument()
  })

  it('restoreDisabledReason (view-only role) disables restore and shows the reason', async () => {
    stubHistoryFetch()
    renderPanel({
      restoreDisabledReason: "Your role can't change published posts"
    })

    const list = await screen.findByRole('list', { name: 'Revisions' })
    const rows = await within(list).findAllByRole('button')
    fireEvent.click(rows[1]!)

    const restore = await screen.findByRole('button', {
      name: 'Restore this revision'
    })
    expect(restore).toBeDisabled()
    expect(
      screen.getByText("Your role can't change published posts")
    ).toBeInTheDocument()
  })

  it('clean buffer: no synthetic unsaved row, HEAD badge stays "Current"', async () => {
    stubHistoryFetch()
    renderPanel()

    const list = await screen.findByRole('list', { name: 'Revisions' })
    // The old revision is preselected — once its diff has rendered, the HEAD
    // fetch (same Promise.all) has settled too, so dirtiness is decided.
    const changes = await screen.findByRole('region', { name: 'Changes' })
    await waitFor(() => expect(changes).toHaveTextContent('Old Title'))
    expect(
      within(list).queryByText('Your unsaved changes')
    ).not.toBeInTheDocument()
    const rows = within(list).getAllByRole('button')
    expect(rows[0]).toHaveTextContent('Current')
    expect(rows[0]).not.toHaveTextContent('Last commit')
  })
})

describe('HistoryPanel with unsaved editor changes (#466 owner UAT)', () => {
  it('pins a "Your unsaved changes · now" row on top and relabels HEAD "Last commit"', async () => {
    stubHistoryFetch()
    renderPanel({ getEditorContent: () => DIRTY_CONTENT })

    const list = await screen.findByRole('list', { name: 'Revisions' })
    const unsaved = await within(list).findByRole('button', {
      name: /Your unsaved changes/
    })
    expect(unsaved).toHaveTextContent('now')
    const rows = within(list).getAllByRole('button')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toBe(unsaved)
    // HEAD is no longer what the user sees — it's the last commit.
    expect(rows[1]).toHaveTextContent('Last commit')
    expect(rows[1]).not.toHaveTextContent('Current')
  })

  it('selecting the synthetic row diffs the live buffer against HEAD', async () => {
    stubHistoryFetch()
    renderPanel({ getEditorContent: () => DIRTY_CONTENT })

    const list = await screen.findByRole('list', { name: 'Revisions' })
    fireEvent.click(
      await within(list).findByRole('button', { name: /Your unsaved changes/ })
    )

    const changes = await screen.findByRole('region', { name: 'Changes' })
    // HEAD body "The slow brown fox." vs buffer "The slow red fox.".
    const removed = await within(changes).findByText('brown')
    expect(removed.tagName).toBe('DEL')
    const added = within(changes).getByText('red')
    expect(added.tagName).toBe('INS')
    // The synthetic row is not a committed revision — nothing to restore.
    const restore = screen.getByRole('button', {
      name: 'Restore this revision'
    })
    expect(restore).toBeDisabled()
  })

  it('diffs a revision against the live buffer, not HEAD (the "no changes" near-data-loss trap)', async () => {
    // Owner repro: the old revision EQUALS HEAD (restore-style history), but
    // the buffer holds unsaved work. Diffing against HEAD would claim "no
    // differences" while Restore silently discards the buffer.
    stubHistoryFetch({ oldContent: HEAD_CONTENT })
    renderPanel({ getEditorContent: () => DIRTY_CONTENT })

    const list = await screen.findByRole('list', { name: 'Revisions' })
    const rows = await within(list).findAllByRole('button')
    fireEvent.click(rows[rows.length - 1]!)

    const changes = await screen.findByRole('region', { name: 'Changes' })
    const added = await within(changes).findByText('red')
    expect(added.tagName).toBe('INS')
    expect(changes).not.toHaveTextContent(/No differences/)
  })

  it('dirty + HEAD row selected shows the buffer diff, not the "current revision" notice', async () => {
    stubHistoryFetch()
    renderPanel({ getEditorContent: () => DIRTY_CONTENT })

    const list = await screen.findByRole('list', { name: 'Revisions' })
    const head = await within(list).findByRole('button', {
      name: /Last commit/
    })
    fireEvent.click(head)

    const changes = await screen.findByRole('region', { name: 'Changes' })
    const added = await within(changes).findByText('red')
    expect(added.tagName).toBe('INS')
    expect(changes).not.toHaveTextContent(/This is the current revision/)
  })

  it('restore dialog carries the destructive discard warning when dirty', async () => {
    stubHistoryFetch()
    renderPanel({ getEditorContent: () => DIRTY_CONTENT })

    const list = await screen.findByRole('list', { name: 'Revisions' })
    // Select the OLD committed revision (the last row).
    const rows = await within(list).findAllByRole('button')
    fireEvent.click(rows[rows.length - 1]!)

    const restore = await screen.findByRole('button', {
      name: 'Restore this revision'
    })
    await waitFor(() => expect(restore).toBeEnabled())
    fireEvent.click(restore)

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('This discards your unsaved changes.')
  })
})
