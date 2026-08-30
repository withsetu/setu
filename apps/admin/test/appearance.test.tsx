import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { GitPort } from '@setu/core'
// #1076: the Customizer no longer imports a theme's options — it FETCHES the active theme's
// declaration, which is what lets any installed theme be customised. The shipped theme's
// declaration is still the fixture here, but it now arrives the way a third-party theme's would.
import { themeOptions } from '@setu/theme-default/options'
import { ActorProvider } from '../src/auth/actor'
import {
  ServicesProvider,
  createServices,
  servicesFor
} from '../src/data/store'
import { NotificationProvider } from '../src/ui/notify'
import { Appearance } from '../src/screens/Appearance'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/api/theme/options'))
        return new Response(
          JSON.stringify({
            theme: '@setu/theme-default',
            options: themeOptions,
            declared: true
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      return new Response('{}', { status: 200 })
    })
  )
})
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

/** Renders and WAITS for the theme declaration to arrive. The screen fetches it now (#1076), so
 *  asserting synchronously would race the load — and would also mask the real regression this
 *  guards: an empty Customizer rendered because the fetch never resolved. */
async function renderAppearance(services = createServices()) {
  const wrapper = (children: ReactNode) => (
    <NotificationProvider>
      <ActorProvider>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
  const result = render(wrapper(<Appearance />))
  await screen.findByText(themeOptions[0]!.label)
  return result
}

describe('Appearance (Customizer)', () => {
  it('renders one control per manifest knob, plus a live preview', async () => {
    await renderAppearance()
    for (const opt of themeOptions) {
      expect(screen.getByText(opt.label)).toBeInTheDocument()
    }
    expect(screen.getByTestId('cz-preview')).toBeInTheDocument()
  })

  it('selecting a different width updates the preview token (--measure-page)', async () => {
    await renderAppearance()
    const preview = screen.getByTestId('cz-preview')
    expect(preview.style.getPropertyValue('--measure-page')).toBe('64rem')
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    expect(preview.style.getPropertyValue('--measure-page')).toBe('78rem')
  })

  it('a valid accent hex flows into the preview; an invalid one is ignored', async () => {
    await renderAppearance()
    const preview = screen.getByTestId('cz-preview')
    const hex = screen.getByLabelText('Hex value')
    fireEvent.change(hex, { target: { value: '#0ea5e9' } })
    expect(preview.style.getPropertyValue('--accent')).toBe('#0ea5e9')
    fireEvent.change(hex, { target: { value: 'nonsense' } })
    expect(preview.style.getPropertyValue('--accent')).toBe('#0ea5e9')
  })

  it('per-knob reset restores the default and hides the reset affordance', async () => {
    await renderAppearance()
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    const widthField = screen
      .getByText('Content width')
      .closest('.cz-field') as HTMLElement
    fireEvent.click(within(widthField).getByRole('button', { name: 'Reset' }))
    expect(
      screen.getByTestId('cz-preview').style.getPropertyValue('--measure-page')
    ).toBe('64rem')
    expect(
      within(widthField).queryByRole('button', { name: 'Reset' })
    ).not.toBeInTheDocument()
  })

  it('"Reset all" returns every knob to its default', async () => {
    await renderAppearance()
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sharp' }))
    fireEvent.click(screen.getByRole('button', { name: /reset all/i }))
    const preview = screen.getByTestId('cz-preview')
    expect(preview.style.getPropertyValue('--measure-page')).toBe('64rem')
    expect(preview.style.getPropertyValue('--radius-base')).toBe('10px')
  })

  it('remembers choices across remount (localStorage)', async () => {
    const { unmount } = await renderAppearance()
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    unmount()
    await renderAppearance()
    expect(
      screen.getByTestId('cz-preview').style.getPropertyValue('--measure-page')
    ).toBe('78rem')
  })
})

describe('Appearance — Publish to site', () => {
  function withGit() {
    const git: GitPort = createMemoryGitPort([])
    return { git, services: servicesFor(createMemoryDataPort([]), git) }
  }

  it('starts "Published" (no pending) with no committed file, then enables on a change', async () => {
    const { services } = withGit()
    await renderAppearance(services)
    // baseline loads (no file → defaults) → nothing to publish
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Published' })).toBeDisabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    expect(
      screen.getByRole('button', { name: 'Publish appearance' })
    ).toBeEnabled()
  })

  it('commits the chosen values to theme-options.json and settles to "Published"', async () => {
    const { git, services } = withGit()
    await renderAppearance(services)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Published' })
      ).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish appearance' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Published' })
      ).toBeInTheDocument()
    )
    const committed = await git.readFile('theme-options.json')
    expect(committed).not.toBeNull()
    expect(JSON.parse(committed as string)).toMatchObject({ width: 'wide' })
  })

  it('reads the committed baseline on mount (a matching working copy is not dirty)', async () => {
    const { git, services } = withGit()
    await git.commitFile({
      path: 'theme-options.json',
      content: JSON.stringify({
        ...Object.fromEntries(themeOptions.map((o) => [o.key, o.default])),
        width: 'wide'
      }),
      message: 'seed',
      author: { name: 'x', email: 'x@y.z' }
    })
    // working copy already matches the committed (published) width
    localStorage.setItem(
      'setu-theme-options',
      JSON.stringify({ width: 'wide' })
    )
    await renderAppearance(services)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Published' })).toBeDisabled()
    )
  })
})
