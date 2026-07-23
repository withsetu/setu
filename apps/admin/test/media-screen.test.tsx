import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import {
  createMemoryDataPort,
  createMemoryIndexPort,
  createMemoryMediaIndexPort
} from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMediaIndexService, INDEX_VERSION } from '@setu/core'
import type { MediaRecord, EntryIndexRow } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { MediaIndexProvider } from '../src/data/media-index-store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { NotificationProvider } from '../src/ui/notify'
import { Media } from '../src/screens/Media'

// ── mock media-client so deleteMedia never hits the network ──
vi.mock('../src/media/media-client', async (orig) => ({
  ...(await orig()),
  deleteMedia: vi.fn(async () => {})
}))

// ── mock upload-client so uploadFile never hits the network ──
vi.mock('../src/media/upload-client', async (orig) => ({
  ...(await orig()),
  uploadFile: vi.fn(async () => ({
    id: '2026/06/dog',
    key: '2026/06/dog.jpg',
    url: 'http://x/media/2026/06/dog.jpg',
    contentType: 'image/jpeg',
    size: 1,
    filename: 'dog.jpg',
    record: {
      mediaKey: '2026/06/dog',
      key: '2026/06/dog.jpg',
      thumbKey: null,
      filename: 'dog.jpg',
      contentType: 'image/jpeg',
      isImage: true,
      width: null,
      height: null,
      bytes: 1,
      uploadedAt: 0
    }
  }))
}))

// import the mock so we can assert on it (MediaTransportError comes from the real
// module — `orig()` is spread above, so only `deleteMedia` is replaced)
import { deleteMedia, MediaTransportError } from '../src/media/media-client'

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
  uploadedAt: Date.now()
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
  date: null,
  tags: [],
  categories: [],
  mediaRefs: ['2026/06/cat'],
  audit: { audited: false, hasTitle: true, imagesWithoutAlt: 0, h1Count: 0 },
  hasFeaturedImage: false,
  hasSeoOverrides: false
}

/** Build providers seeded with `catRecord` and a content index row referencing it. */
async function buildProviders() {
  // Content index port seeded with a row that references the cat image; meta
  // marked built so IndexProvider's mount-time ensureBuilt (Media now reads
  // referencedBy through useIndex(), #464) doesn't rebuild over the seed.
  const indexPort = createMemoryIndexPort()
  await indexPort.upsert(catRef)
  await indexPort.setMeta({
    indexedSha: null,
    deployedSha: null,
    version: INDEX_VERSION
  })

  // Media index service seeded with catRecord
  const mediaIndexPort = createMemoryMediaIndexPort()
  const mediaIndex = createMediaIndexService({
    mediaIndex: mediaIndexPort,
    fetchRaw: async () => [catRecord]
  })
  await mediaIndex.ensureBuilt()

  // Services bundle — pass the seeded index port so referencedBy works
  const services = servicesFor(
    createMemoryDataPort([]),
    createMemoryGitPort(),
    indexPort,
    mediaIndex
  )

  return { services, mediaIndex }
}

function wrapper(
  services: ReturnType<typeof servicesFor>,
  mediaIndex: ReturnType<typeof createMediaIndexService>
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <ActorProvider>
          <ServicesProvider services={services}>
            <DeployProvider>
              <IndexProvider>
                <MediaIndexProvider service={mediaIndex}>
                  <NotificationProvider>{children}</NotificationProvider>
                </MediaIndexProvider>
              </IndexProvider>
            </DeployProvider>
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
    expect(
      screen.getByRole('combobox', { name: /Filter by type/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('searchbox', { name: /Search media/i })
    ).toBeInTheDocument()
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
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /cat\.png/i })
      ).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    expect(
      screen.getByRole('dialog', { name: /Media details/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Delete cat\.png/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Copy URL/i })
    ).toBeInTheDocument()
  })

  it('shows the referencing post title in the confirm and deletes on confirm', async () => {
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })

    // wait for tile to appear
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /cat\.png/i })
      ).toBeInTheDocument()
    )

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

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /cat\.png/i })
      ).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    expect(
      screen.getByRole('dialog', { name: /Media details/i })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))
    // wait for AlertDialog to open
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /Media details/i })
      ).not.toBeInTheDocument()
    )
  })

  it('does NOT delete if user cancels', async () => {
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /cat\.png/i })
      ).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))
    // wait for AlertDialog to open
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(deleteMedia).not.toHaveBeenCalled()
    expect(
      screen.getByRole('dialog', { name: /Media details/i })
    ).toBeInTheDocument()
  })

  /** Open the detail panel for cat.png and confirm the delete. */
  async function deleteTheCat() {
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /cat\.png/i })
      ).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))
    // wait for AlertDialog to open
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  }

  // -------------------------------------------------------------------------------
  // #870 — the delete catch echoed `err.message` for every failure, so a transport
  // failure showed fetch's raw "Failed to fetch". Blindly curating it would have
  // swallowed the server's own reason (a 409 "media is in use"), which is the #852
  // inversion — so the two directions BOTH matter, and both are asserted here.
  // -------------------------------------------------------------------------------
  it('curates a transport failure instead of echoing "Failed to fetch"', async () => {
    vi.mocked(deleteMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new MediaTransportError(new TypeError('Failed to fetch'))
    )
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })
    await deleteTheCat()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/check your connection/i)
    expect(alert).not.toHaveTextContent(/failed to fetch/i)
  })

  it('shows the server’s own reason verbatim on a response error', async () => {
    vi.mocked(deleteMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('media is in use')
    )
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })
    await deleteTheCat()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('media is in use')
    expect(alert).not.toHaveTextContent(/check your connection/i)
  })

  it('surfaces a success toast after a successful delete', async () => {
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /cat\.png/i })
      ).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: /cat\.png/i }))
    fireEvent.click(screen.getByRole('button', { name: /Delete cat\.png/i }))
    // wait for AlertDialog to open
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(screen.getByText('Deleted cat.png')).toBeInTheDocument()
    })
  })

  it('surfaces an "Uploaded" toast after a successful upload', async () => {
    const { services, mediaIndex } = await buildProviders()
    render(<Media />, { wrapper: wrapper(services, mediaIndex) })

    // Wait for the screen to be ready (dropzone is present from the start)
    const input = await screen.findByTestId('media-dropzone-input')
    const file = new File([new Uint8Array([1])], 'dog.jpg', {
      type: 'image/jpeg'
    })
    fireEvent.change(input, { target: { files: [file] } })

    // The mocked uploadFile returns filename 'dog.jpg' → toast says 'Uploaded dog.jpg'
    await screen.findByText(/Uploaded dog\.jpg/)
  })

  // -------------------------------------------------------------------------------
  // #804 — `void mediaIndex.upsertOne(result.record)` discarded a rejection after a
  // SUCCESSFUL upload, so a failed index write was indistinguishable from success:
  // no toast, and (in a topology where the client index is the read source) no tile.
  // The upload itself is unaffected — the file and its record are already stored
  // server-side — so the fix says exactly that and re-queries the grid, which is the
  // recovery in the server-backed topology.
  // -------------------------------------------------------------------------------
  it('reports a failed index update after a successful upload, and still re-queries the grid', async () => {
    const { services, mediaIndex } = await buildProviders()
    const query = vi.fn(mediaIndex.query)
    const failingIndex = {
      ...mediaIndex,
      query,
      upsertOne: () => Promise.reject(new Error('index write failed'))
    }
    render(<Media />, { wrapper: wrapper(services, failingIndex) })

    // Let the grid finish its mount-time load before counting re-queries.
    await waitFor(() => expect(screen.getByText('cat.png')).toBeInTheDocument())
    const queriesBefore = query.mock.calls.length

    const input = await screen.findByTestId('media-dropzone-input')
    const file = new File([new Uint8Array([1])], 'dog.jpg', {
      type: 'image/jpeg'
    })
    fireEvent.change(input, { target: { files: [file] } })

    // The upload succeeded — say so — but the failure is visible too, and claims
    // nothing about the file itself.
    await screen.findByText('Uploaded dog.jpg')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/media list/i)

    // Recovery: the grid re-queries rather than trusting the write that failed.
    await waitFor(() =>
      expect(query.mock.calls.length).toBeGreaterThan(queriesBefore)
    )
  })
})
