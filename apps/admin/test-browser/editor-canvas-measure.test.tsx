import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page } from 'vitest/browser'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Actor, ThemeOption } from '@setu/core'
import { contentPath, serializeMdoc } from '@setu/core'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { TaxonomyProvider } from '../src/data/taxonomy-store'
import { EditorScreen } from '../src/editor/EditorScreen'
import { NotificationProvider } from '../src/ui/notify'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { CommandRegistryProvider } from '../src/command/registry'
import '../src/index.css'

// ---------------------------------------------------------------------------------
// #1296 — the editor canvas sizes Wide/Full blocks by the ACTIVE theme's published measure,
// not a hardcoded 64rem. Before this, a site on Content width = Wide (78rem) had the Customizer
// preview tracking 78rem while the editor composed every Wide block at 64rem.
//
// Real chromium + the real EditorScreen + the real stylesheet: the assertion is the laid-out
// width of a Wide section's wrapper in the canvas, which only a layout engine can produce.
// The theme declaration below is a fixture third-party theme (apps/admin must never import a
// theme package — see apps/admin/test/appearance.test.tsx), with theme-default's width choices.
// ---------------------------------------------------------------------------------

const declaration: ThemeOption[] = [
  {
    key: 'width',
    label: 'Content width',
    type: 'select',
    token: '--measure-page',
    default: 'normal',
    choices: [
      { value: 'narrow', label: 'Narrow', tokenValue: '52rem' },
      { value: 'normal', label: 'Normal', tokenValue: '64rem' },
      { value: 'wide', label: 'Wide', tokenValue: '78rem' }
    ]
  }
]

const ref = { collection: 'post', locale: 'en', slug: 'wide-post' }

function services(themeValues: Record<string, string> | null) {
  const seed = [
    {
      path: contentPath(ref),
      content: serializeMdoc({
        frontmatter: { title: 'Wide Post', published: false },
        body: '{% section background="soft" width="wide" %}\nInside the band.\n{% /section %}'
      })
    },
    ...(themeValues
      ? [{ path: 'theme-options.json', content: JSON.stringify(themeValues) }]
      : [])
  ]
  return servicesFor(createMemoryDataPort(), createMemoryGitPort(seed))
}

let themeRequests = 0
beforeEach(async () => {
  themeRequests = 0
  await page.viewport(1800, 1000)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/api/theme/options')) {
        themeRequests++
        return new Response(
          JSON.stringify({ theme: '@acme/theme', options: declaration }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response('{}', { status: 200 })
    })
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderEditor(
  actor: Actor,
  themeValues: Record<string, string> | null
) {
  return render(
    <TooltipProvider>
      <NotificationProvider>
        <MemoryRouter initialEntries={['/edit/post/en/wide-post']}>
          <ActorProvider actor={actor}>
            <ServicesProvider services={services(themeValues)}>
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

const rem = (n: number) =>
  n * parseFloat(getComputedStyle(document.documentElement).fontSize)

/** The canvas-level wrapper of the Wide section — what editor.css sizes to --measure-page. */
function wideBandWidth(): number {
  const band = document.querySelector('.setu-prose .blk-section.w-wide')
  let el = band as HTMLElement | null
  while (el && el.parentElement && !el.parentElement.matches('.setu-prose'))
    el = el.parentElement
  return el ? el.getBoundingClientRect().width : 0
}

describe('editor canvas tracks the theme’s Content width (#1296, real browser)', () => {
  it('Content width = Wide: the canvas measure is 78rem and a Wide block lays out at it', async () => {
    renderEditor({ id: 'a1', role: 'admin' }, { width: 'wide' })
    await expect.element(page.getByText('Inside the band.')).toBeInTheDocument()

    const canvas = document.querySelector('.ed-canvas') as HTMLElement
    await expect
      .poll(() => getComputedStyle(canvas).getPropertyValue('--measure-page'))
      .toBe('78rem')
    await expect.poll(wideBandWidth).toBeCloseTo(rem(78), 0)
  })

  it('nothing published: the theme default (Normal, 64rem) applies', async () => {
    renderEditor({ id: 'a1', role: 'admin' }, null)
    await expect.element(page.getByText('Inside the band.')).toBeInTheDocument()
    await expect.poll(() => themeRequests).toBe(1)
    await expect.poll(wideBandWidth).toBeCloseTo(rem(64), 0)
  })

  it('a role that cannot read the theme declaration keeps the contract default and is not nagged', async () => {
    renderEditor({ id: 'e1', role: 'editor' }, { width: 'wide' })
    await expect.element(page.getByText('Inside the band.')).toBeInTheDocument()
    await expect.poll(wideBandWidth).toBeCloseTo(rem(64), 0)
    expect(themeRequests).toBe(0)
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})
