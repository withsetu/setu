import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { JSONContent } from '@tiptap/core'
import type { ContentRow } from '@setu/core'
import { HeroBlock } from '../src/editor/extensions/HeroBlock'
import { ImageBlock } from '../src/editor/extensions/ImageBlock'
import { ContactBlock } from '../src/editor/extensions/ContactBlock'
import { LatestPostsBlock } from '../src/editor/extensions/LatestPostsBlock'
import { Callout } from '../src/editor/extensions/Callout'
import {
  ensureFormId,
  DEFAULT_SUCCESS_MESSAGE
} from '../src/editor/extensions/contact-helpers'

// ---------------------------------------------------------------------------------
// Node-view render checks (#293 target 2): hero / image / contact / callout, mounted
// against a REAL Tiptap editor in real chromium. jsdom already covers hero's static
// render (test/hero-block-node.test.tsx) — this file's job is the REST of the gap:
// image/contact/callout have never had a node-view test at all, and all four gain
// real value here from accessible-structure assertions driven by getByRole/getByLabel
// against the real accessibility tree (jsdom's a11y tree computation is unreliable —
// e.g. it does not run real focus/measurement — so "toolbar", "combobox" etc. roles
// are only trustworthy when actually computed by a real browser).
// ---------------------------------------------------------------------------------

afterEach(cleanup)

function Harness({
  extensions,
  content
}: {
  extensions: Parameters<typeof useEditor>[0]['extensions']
  content: JSONContent
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content
  })
  return <EditorContent editor={editor} />
}

describe('HeroBlock node view (real browser)', () => {
  it('renders an accessible hero with headline, subhead, and CTA', async () => {
    render(
      <Harness
        extensions={[StarterKit, HeroBlock]}
        content={{
          type: 'doc',
          content: [
            {
              type: 'heroBlock',
              attrs: {
                mdAttrs: {
                  headline: 'Welcome to Setu',
                  subhead: 'A Git-backed CMS',
                  ctaLabel: 'Get started',
                  layout: 'centered'
                }
              }
            }
          ]
        }}
      />
    )
    await expect
      .element(page.getByRole('heading', { name: 'Welcome to Setu' }))
      .toBeInTheDocument()
    await expect.element(page.getByText('A Git-backed CMS')).toBeInTheDocument()
    await expect.element(page.getByText('Get started')).toBeInTheDocument()
  })
})

describe('ImageBlock node view (real browser)', () => {
  it('renders an accessible toolbar with align control, alt text, and caption inputs', async () => {
    render(
      <Harness
        extensions={[StarterKit, ImageBlock]}
        content={{
          type: 'doc',
          content: [
            {
              type: 'imageBlock',
              attrs: {
                mdAttrs: {
                  src: '/media/2026/07/photo.jpg',
                  alt: 'A scenic photo',
                  caption: 'Taken on the trail',
                  align: 'wide'
                }
              }
            }
          ]
        }}
      />
    )
    const toolbar = page.getByRole('toolbar', { name: 'Image' })
    await expect.element(toolbar).toBeInTheDocument()
    await expect
      .element(page.getByPlaceholder('Alt text…'))
      .toHaveValue('A scenic photo')
    await expect
      .element(page.getByPlaceholder('Add a caption…'))
      .toHaveValue('Taken on the trail')
    await expect
      .element(page.getByRole('button', { name: 'Replace' }))
      .toBeInTheDocument()
  })
})

describe('ContactBlock node view (real browser)', () => {
  it('renders the form preview and opens the real Radix Popover settings panel', async () => {
    render(
      <Harness
        extensions={[StarterKit, ContactBlock]}
        content={{
          type: 'doc',
          content: [
            {
              type: 'contactBlock',
              attrs: {
                mdAttrs: ensureFormId({
                  formLabel: 'Sales',
                  subject: true,
                  nameRequired: true,
                  subjectRequired: false,
                  successMessage: DEFAULT_SUCCESS_MESSAGE
                })
              }
            }
          ]
        }}
      />
    )
    await expect
      .element(page.getByText('Contact form · Sales'))
      .toBeInTheDocument()

    // Real Radix Popover: closed by default, opens a real portal on trigger click.
    const trigger = page.getByRole('button', { name: 'Form settings' })
    await expect.element(trigger).toBeInTheDocument()
    await expect
      .element(page.getByLabelText('Subject field'))
      .not.toBeInTheDocument()
    await trigger.click()
    await expect
      .element(page.getByLabelText('Subject field'))
      .toBeInTheDocument()
    await expect.element(page.getByLabelText('Subject field')).toBeChecked()
  })
})

describe('LatestPostsBlock node view (real browser)', () => {
  const row = (
    slug: string,
    title: string,
    date: number | null
  ): ContentRow => ({
    ref: { collection: 'post', locale: 'en', slug },
    title,
    locale: 'en',
    lifecycle: { state: 'live' },
    updatedAt: date,
    hasDraft: false,
    date,
    tags: [],
    categories: [],
    mediaRefs: [],
    hasFeaturedImage: false,
    hasSeoOverrides: false
  })

  it('renders REAL post titles + dates from the injected content-index query (#192)', async () => {
    const runQuery = () =>
      Promise.resolve({
        rows: [
          row('newest', 'Newest post', Date.UTC(2026, 5, 20)),
          row('older', 'Older post', null)
        ],
        total: 2
      })
    render(
      <Harness
        extensions={[StarterKit, LatestPostsBlock.configure({ runQuery })]}
        content={{
          type: 'doc',
          content: [{ type: 'latestPostsBlock', attrs: { mdAttrs: {} } }]
        }}
      />
    )
    // Live preview — actual titles from the (stubbed) index, not a grey placeholder.
    await expect.element(page.getByText('Newest post')).toBeInTheDocument()
    await expect.element(page.getByText('Older post')).toBeInTheDocument()
    // showDate defaults ON for latest-posts: the dated row renders a formatted date.
    await expect.element(page.getByText('Jun 20, 2026')).toBeInTheDocument()
    // Chrome header names the block, with the count from the query.
    await expect.element(page.getByText(/Latest Posts ·/)).toBeInTheDocument()
    await expect.element(page.getByText('2 posts')).toBeInTheDocument()
  })

  it('hides dates when showDate=false', async () => {
    const runQuery = () =>
      Promise.resolve({
        rows: [row('newest', 'Dated post', Date.UTC(2026, 5, 20))],
        total: 1
      })
    render(
      <Harness
        extensions={[StarterKit, LatestPostsBlock.configure({ runQuery })]}
        content={{
          type: 'doc',
          content: [
            {
              type: 'latestPostsBlock',
              attrs: { mdAttrs: { showDate: false } }
            }
          ]
        }}
      />
    )
    await expect.element(page.getByText('Dated post')).toBeInTheDocument()
    await expect.element(page.getByText('Jun 20, 2026')).not.toBeInTheDocument()
  })
})

describe('Callout node view (real browser)', () => {
  it('renders the toolbar, title input, and an editable body region', async () => {
    render(
      <Harness
        extensions={[StarterKit, Callout]}
        content={{
          type: 'doc',
          content: [
            {
              type: 'callout',
              attrs: { mdAttrs: { type: 'success', title: 'Nice work' } },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Ship it.' }]
                }
              ]
            }
          ]
        }}
      />
    )
    const toolbar = page.getByRole('toolbar', { name: 'Callout style' })
    await expect.element(toolbar).toBeInTheDocument()
    await expect
      .element(page.getByPlaceholder('Add a title…'))
      .toHaveValue('Nice work')
    const body = page.getByLabelText('Callout text')
    await expect.element(body).toBeInTheDocument()
    await expect.element(body).toHaveTextContent('Ship it.')
    // One tone swatch per declared variant, each independently reachable by its
    // accessible name — the toolbar's tone picker is real, labeled buttons, not
    // decorative chrome.
    await expect
      .element(page.getByRole('button', { name: 'Success' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Warning' }))
      .toBeInTheDocument()
  })
})
