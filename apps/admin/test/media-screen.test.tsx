import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryDataPort, createMemoryIndexPort, createMemoryMediaIndexPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMediaIndexService } from '@setu/core'
import type { MediaRecord, EntryIndexRow } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { MediaIndexProvider } from '../src/data/media-index-store'
import { NotificationProvider } from '../src/ui/notify'
import { Media } from '../src/screens/Media'

// ── mock media-client so deleteMedia never hits the network ──
vi.mock('../src/media/media-client', async (orig) => ({
  ...(await orig() as object),
  deleteMedia: vi.fn(async () => {}),
}))

// ── mock upload-client so uploadFile never hits the network ──
vi.mock('../src/media/upload-client', async (orig) => ({
  ...(await orig() as object),
  uploadFile: vi.fn(async () => ({
    id: '2026/06/dog', key: '2026/06/dog.jpg', url: 'http://x/media/2026/06/dog.jpg',
    contentType: 'image/jpeg', size: 1, filename: 'dog.jpg',
    record: { mediaKey: '2026/06/dog', key: '2026/06/dog.jpg', thumbKey: null, filename: 'dog.jpg', contentType: 'image/jpeg', isImage: true, width: null, height: null, bytes: 1, uploadedAt: 0 },
  })),
}))

// import the mock so we can assert on it
import { deleteMedia } from '../src/media/media-client'

afterEach(() => vi.clearAllMocks())

// ── helpers ──────────────────────────────────────────────────

/** One seeded media record at key '2026/06/cat', filename 'cat.png'. */
const catRecord: MediaRecord = {
  mediaKey: '2026/06/cat',
  key: '2026/06/cat.png',
  thumbKey: null,
  filename: 'cat.png',
  contentType: 'image/png',
  isImage: true,
  width: 800,
  height: 600,
  bytes: 12345,
  uploadedAt: Date.now(),
}

/** One seeded content index row that references the cat image. */
const catRef: EntryIndexRow = {
  key: 'post\0en\0my-post',
  collection: 'post',
  locale: 'en',
  slug: 'my-post',
  title: 'My Post',
  titleLower: 'my post',
  status: 'draft',
  updatedAt: null,
  hasDraft: true,
  tags: [],
  categories: [],
  mediaRefs: ['2026/06/cat'],
}

/** Build providers seeded with `catRecord` and a content index row referencing it. */
async function buildProviders() {
  // Content index port seeded with a row that references the cat image
  const indexPort = createMemoryIndexPort()
  await indexPort.upsert(catRef)

  // Media index service seeded with catRecord
  const mediaIndexPort = createMemoryMediaIndexPort()
  const mediaIndex = createMediaIndexService({
    mediaIndex: mediaIndexPort,
    fetchRaw: async () => [catRecord],
  })
  await mediaIndex.ensureBuilt()

  // Services bundle — pass the seeded index port so referencedBy works
  const services = servicesFor(
    createMemoryDataPort([]),
    createMemoryGitPort(),
    indexPort,
    mediaIndex,
  )

  return { services, mediaIndex }
}

function wrapper(services: ReturnType<typeof servicesFor>, mediaIndex: ReturnType<typeof createMediaIndexService>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <ActorProvider>
          <ServicesProvider services={services}>
            <MediaIndexProvider service={mediaIndex}>
              <NotificationProvider>
                {children}
              </NotificationProvider>
            </MediaIndexProvider>
          </ServicesProvider>
        </ActorProvider>
      </MemoryRouter>
    )
  }
}

// ── tests ─────────────────────────────────────────────────────

describe('Media screen', () => {
  it('renders the media library heading and toolbar', async () => {
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })
    expect(screen.getByRole('heading', { name: /Media/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Sort/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Filter by type/i })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /Search media/i })).toBeInTheDocument()
  })

  it('shows the cat.png tile from the seeded media index', async () => {
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })
    await waitFor(() => expect(screen.getByText('cat.png')).toBeInTheDocument())
  })

  it('opens the detail panel when a tile is selected', async () => {
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })
    // wait for tile
    await waitFor(() => expect(screen.getByRole('button', { name: /cat\.png/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    expect(screen.getByRole('dialog', { name: /Media details/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Delete cat\.png/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copy URL/i })).toBeInTheDocument()
  })

  it('shows the referencing post title in the confirm and deletes on confirm', async () => {
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })

    // wait for tile to appear
    await waitFor(() => expect(screen.getByRole('button', { name: /cat\.png/i })).toBeInTheDocument())

    // open the detail panel
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))

    // click the delete trigger button (opens AlertDialog after async referencedBy)
    fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))

    // AlertDialog should show the referencing post title
    await waitFor(() => expect(screen.getByText(/My Post/)).toBeInTheDocument())

    // click the AlertDialog confirm action (exact name match)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    // deleteMedia should be called with the correct apiBase and mediaKey
    await waitFor(() => {
      expect(deleteMedia).toHaveBeenCalledWith('', '2026/06/cat')
    })
  })

  it('closes the detail panel after a successful delete', async () => {
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })

    await waitFor(() => expect(screen.getByRole('button', { name: /cat\.png/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    expect(screen.getByRole('dialog', { name: /Media details/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))
    // wait for AlertDialog to open
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Media details/i })).not.toBeInTheDocument())
  })

  it('does NOT delete if user cancels', async () => {
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })

    await waitFor(() => expect(screen.getByRole('button', { name: /cat\.png/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))
    // wait for AlertDialog to open
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(deleteMedia).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /Media details/i })).toBeInTheDocument()
  })

  it('surfaces delete errors as an error toast notification', async () => {
    vi.mocked(deleteMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('server error'))
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })

    await waitFor(() => expect(screen.getByRole('button', { name: /cat\.png/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))
    // wait for AlertDialog to open
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('server error')
    })
  })

  it('surfaces a success toast after a successful delete', async () => {
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })

    await waitFor(() => expect(screen.getByRole('button', { name: /cat\.png/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))
    // wait for AlertDialog to open
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(screen.getByText('Deleted cat.png')).toBeInTheDocument()
    })
  })

  it('surfaces an "Uploaded" toast after a successful upload', async () => {
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })

    // Wait for the screen to be ready (dropzone is present from the start)
    const input = await screen.findByTestId('media-dropzone-input') as HTMLInputElement
    const file = new File([new Uint8Array([1])], 'dog.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })

    // The mocked uploadFile returns filename 'dog.jpg' → toast says 'Uploaded dog.jpg'
    await screen.findByText(/Uploaded dog\.jpg/)
  })
})
