import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Draft, TiptapDoc } from '@setu/core'
import { createBulkService, createMediaIndexService } from '@setu/core'
import {
  createMemoryIndexPort,
  createMemoryMediaIndexPort,
  createMemorySubmissionPort
} from '@setu/db-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider } from '../src/data/store'
import type { Services } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import {
  CommandRegistryProvider,
  useCommandRegistry
} from '../src/command/registry'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})
const aDraft: Draft = {
  collection: 'post',
  locale: 'en',
  slug: 'p1',
  content: doc('Hello body'),
  metadata: { title: 'Hello', status: 'draft' },
  baseSha: null,
  createdAt: 0,
  updatedAt: 0
}
const aLock = {
  collection: 'post',
  locale: 'en',
  slug: 'p1',
  lockedBy: 'local',
  lockedAt: 0
}

function fakeServices(over: Partial<Services> = {}): Services {
  const save = vi.fn(async (input: { metadata: Record<string, unknown> }) => ({
    saved: true,
    outcome: 'refreshed',
    lock: aLock,
    draft: { ...aDraft, ...input }
  }))
  const data = {
    getDraft: vi.fn(async () => aDraft)
  } as unknown as Services['data']
  const git = {
    readFile: vi.fn(async () => null)
  } as unknown as Services['git']
  const read = {
    loadForEdit: vi.fn(async () => ({ source: 'draft', draft: aDraft }))
  } as unknown as Services['read']
  return {
    data,
    git,
    read,
    authoring: {
      open: vi.fn(async () => ({
        granted: true,
        outcome: 'acquired',
        lock: aLock,
        draft: aDraft
      })),
      save,
      release: vi.fn(),
      forceUnlock: vi.fn(),
      status: vi.fn()
    } as unknown as Services['authoring'],
    publish: {
      publish: vi.fn(async () => ({ status: 'nothing' as const }))
    },
    index: createMemoryIndexPort(),
    bulk: createBulkService({
      data,
      git,
      read,
      author: { name: 'T', email: 't@x.com' }
    }),
    mediaIndex: createMediaIndexService({
      mediaIndex: createMemoryMediaIndexPort(),
      fetchRaw: async () => []
    }),
    submissions: createMemorySubmissionPort(),
    ...over
  }
}

// Probe reads the registry at call time (via a callback that captures the live registry).
// We use a ref-forwarding approach: render a Probe that stores the registry value in a
// module-level variable so tests can read it imperatively after the component renders.
let capturedCommands: ReturnType<typeof useCommandRegistry>['commands'] = []

function CommandCapture() {
  const { commands } = useCommandRegistry()
  capturedCommands = commands
  return null
}

function renderEditor(services: Services, path = '/edit/post/en/p1') {
  capturedCommands = []
  return render(
    <TooltipProvider>
      <NotificationProvider>
        <MemoryRouter initialEntries={[path]}>
          <ActorProvider>
            <ServicesProvider services={services}>
              <DeployProvider>
                <IndexProvider>
                  <TaxonomyProvider>
                    <CommandRegistryProvider>
                      <Routes>
                        <Route
                          path="/edit/:collection/:locale/:slug"
                          element={<EditorScreen />}
                        />
                      </Routes>
                      <CommandCapture />
                    </CommandRegistryProvider>
                  </TaxonomyProvider>
                </IndexProvider>
              </DeployProvider>
            </ServicesProvider>
          </ActorProvider>
        </MemoryRouter>
      </NotificationProvider>
    </TooltipProvider>
  )
}

describe('EditorScreen — editor commands', () => {
  it('registers a Publish command in the Editor group when phase=ready and not composing', async () => {
    renderEditor(fakeServices())
    // Wait for the editor to load (title becomes visible = phase reached 'ready')
    await screen.findByDisplayValue('Hello')
    // Wait for the Publish command to be registered in the registry
    await waitFor(() => {
      const cmd = capturedCommands.find((c) => c.id === 'editor.publish')
      expect(cmd).toBeDefined()
    })
    const publishCmd = capturedCommands.find((c) => c.id === 'editor.publish')!
    expect(publishCmd.title).toBe('Publish')
    expect(publishCmd.group).toBe('Editor')
    // enabled() is a live closure through the ref-delegation in useRegisterCommands:
    // after phase='ready' and composing=false, it should return true.
    expect(publishCmd.enabled?.()).toBe(true)
  })

  it('Publish enabled() is false when composing (slug=new)', async () => {
    // When composing, slug is 'new', so composing===true → enabled() returns false
    renderEditor(fakeServices(), '/edit/post/en/new')
    // composing path hits ready synchronously after init; wait for Title input
    await screen.findByLabelText('Title')
    await waitFor(() => {
      const cmd = capturedCommands.find((c) => c.id === 'editor.publish')
      expect(cmd).toBeDefined()
    })
    const publishCmd = capturedCommands.find((c) => c.id === 'editor.publish')!
    // composing=true → enabled() must be false
    expect(publishCmd.enabled?.()).toBe(false)
  })

  it('registers a Preview draft command in the Editor group', async () => {
    renderEditor(fakeServices())
    await screen.findByDisplayValue('Hello')
    await waitFor(() => {
      expect(
        capturedCommands.find((c) => c.id === 'editor.preview')
      ).toBeDefined()
    })
    const previewCmd = capturedCommands.find((c) => c.id === 'editor.preview')!
    expect(previewCmd.title).toBe('Preview draft')
    expect(previewCmd.group).toBe('Editor')
  })

  it('registers an Unpublish command in the Editor group', async () => {
    renderEditor(fakeServices())
    await screen.findByDisplayValue('Hello')
    await waitFor(() => {
      expect(
        capturedCommands.find((c) => c.id === 'editor.unpublish')
      ).toBeDefined()
    })
    const unpublishCmd = capturedCommands.find(
      (c) => c.id === 'editor.unpublish'
    )!
    expect(unpublishCmd.title).toBe('Unpublish')
    expect(unpublishCmd.group).toBe('Editor')
  })
})
