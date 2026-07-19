import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Actor, TiptapDoc } from '@setu/core'
import { contentPath, serializeMdoc } from '@setu/core'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import type { Services } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { Canvas } from '../src/editor/Canvas'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { CommandRegistryProvider } from '../src/command/registry'

// ---------------------------------------------------------------------------------
// #382 view-only editor — the browser-mode half of apps/admin/test/editor-viewonly.
// The jsdom suite proves the LOGIC (banner, disabled title, autosave never fires),
// but it cannot prove that ProseMirror actually swallows keystrokes when Canvas gets
// `editable={false}`: jsdom has no real contenteditable/selection/beforeinput
// pipeline, so a jsdom "can't type" assertion would be vacuous (CLAUDE.md failure
// mode #3, the jsdom Mirage). This file mounts the REAL EditorScreen (real services,
// a committed LIVE entry seeded in the git port) in real chromium, tries to type
// into the real Tiptap canvas, and asserts the document does NOT change — plus a
// control case proving the same harness CAN type when the actor is a publisher,
// so the negative assertion is demonstrably non-vacuous.
// ---------------------------------------------------------------------------------

afterEach(cleanup)

const BODY_TEXT = 'Original body text stays intact.'
const INTRUDER = 'INTRUDER TYPED THIS'

const ref = { collection: 'post', locale: 'en', slug: 'live-post' }

/** Real services with one committed LIVE entry in Git (no pre-existing draft) —
 *  loadForEdit forks the draft from the same committed file the #382 live gate
 *  reads, exactly the app's own composition. */
function servicesWithLiveEntry(): Services {
  const seed = [
    {
      path: contentPath(ref),
      content: serializeMdoc({
        frontmatter: { title: 'Live Post' },
        body: BODY_TEXT
      })
    }
  ]
  return servicesFor(createMemoryDataPort(), createMemoryGitPort(seed))
}

function renderEditor(actor: Actor) {
  return render(
    <TooltipProvider>
      <NotificationProvider>
        <MemoryRouter initialEntries={['/edit/post/en/live-post']}>
          <ActorProvider actor={actor}>
            <ServicesProvider services={servicesWithLiveEntry()}>
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

describe('view-only canvas blocks real input (#382, real browser)', () => {
  it('author on a live post: banner shows and typing into the canvas does not change the document', async () => {
    renderEditor({ id: 'a1', role: 'author' })

    // Real canvas mounted with the committed body.
    const canvas = page.getByLabelText('Content editor')
    await expect.element(canvas).toBeInTheDocument()
    await expect.element(page.getByText(BODY_TEXT)).toBeInTheDocument()

    // The honest-UI banner is visible.
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(/This post is live/)

    // Attempt to type into the real ProseMirror canvas the way a user would.
    await userEvent.click(page.getByText(BODY_TEXT))
    await userEvent.keyboard(INTRUDER)

    // The document did not change: original text intact, nothing inserted.
    await expect.element(page.getByText(BODY_TEXT)).toBeInTheDocument()
    await expect
      .element(page.getByText(INTRUDER, { exact: false }))
      .not.toBeInTheDocument()
    // And ProseMirror really is non-editable at the DOM level.
    await expect.element(canvas).toHaveAttribute('contenteditable', 'false')
  })

  it('control: a publisher (editor role) CAN type into the same canvas — the harness is not vacuous', async () => {
    renderEditor({ id: 'e1', role: 'editor' })

    const canvas = page.getByLabelText('Content editor')
    await expect.element(canvas).toBeInTheDocument()
    await expect.element(page.getByText(BODY_TEXT)).toBeInTheDocument()
    await expect.element(canvas).toHaveAttribute('contenteditable', 'true')

    await userEvent.click(page.getByText(BODY_TEXT))
    await userEvent.keyboard(INTRUDER)

    // Same actions, editable canvas: the keystrokes DO land.
    await expect
      .element(page.getByText(INTRUDER, { exact: false }))
      .toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------
// #490 in-place editable flip: with the mint-stable subtree key, a post-mint
// ready→readonly transition (lock lost to another editor) reaches a MOUNTED Canvas
// as an `editable` prop change instead of a remount — and @tiptap/react's useEditor
// (no deps array) preserves the live instance's editability across option changes,
// so without Canvas's setEditable effect the flip is inert: an editable canvas under
// a read-only banner, with autosave off. Only a real browser can prove the DOM-level
// contenteditable actually flips (same jsdom-Mirage reasoning as the suite above).
// ---------------------------------------------------------------------------------
describe('in-place editable flip propagates to the live Tiptap instance (#490)', () => {
  it('rerendering the SAME Canvas with editable=false makes ProseMirror non-editable and swallows typing', async () => {
    const BODY = 'Flip test body text.'
    const doc: TiptapDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: BODY }] }]
    }
    const ui = (editable: boolean) => (
      <TooltipProvider>
        <NotificationProvider>
          <Canvas
            initialContent={doc}
            editable={editable}
            onChange={() => {}}
          />
        </NotificationProvider>
      </TooltipProvider>
    )
    const { rerender } = render(ui(true))

    const canvas = page.getByLabelText('Content editor')
    await expect.element(canvas).toBeInTheDocument()
    await expect.element(canvas).toHaveAttribute('contenteditable', 'true')

    // Same instance, prop flip only — no remount (the #490 mint-stable key path).
    rerender(ui(false))

    await expect.element(canvas).toHaveAttribute('contenteditable', 'false')
    await userEvent.click(page.getByText(BODY))
    await userEvent.keyboard(INTRUDER)
    await expect.element(page.getByText(BODY)).toBeInTheDocument()
    await expect
      .element(page.getByText(INTRUDER, { exact: false }))
      .not.toBeInTheDocument()

    // And back: a regained lock re-enables editing in place.
    rerender(ui(true))
    await expect.element(canvas).toHaveAttribute('contenteditable', 'true')
  })
})
