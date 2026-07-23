import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
import { themeOptions } from '@setu/theme-default/options'
import { ActorProvider } from '../src/auth/actor'
import {
  ServicesProvider,
  createServices,
  servicesFor
} from '../src/data/store'
import { NotificationProvider } from '../src/ui/notify'
import { Appearance } from '../src/screens/Appearance'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

function renderAppearance(services = createServices()) {
  const wrapper = (children: ReactNode) => (
    <NotificationProvider>
      <ActorProvider>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
  return render(wrapper(<Appearance />))
}

describe('Appearance (Customizer)', () => {
  it('renders one control per manifest knob, plus a live preview', () => {
    renderAppearance()
    for (const opt of themeOptions) {
      expect(screen.getByText(opt.label)).toBeInTheDocument()
    }
    expect(screen.getByTestId('cz-preview')).toBeInTheDocument()
  })

  it('selecting a different width updates the preview token (--measure-page)', () => {
    renderAppearance()
    const preview = screen.getByTestId('cz-preview')
    expect(preview.style.getPropertyValue('--measure-page')).toBe('64rem')
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    expect(preview.style.getPropertyValue('--measure-page')).toBe('78rem')
  })

  it('a valid accent hex flows into the preview; an invalid one is ignored', () => {
    renderAppearance()
    const preview = screen.getByTestId('cz-preview')
    const hex = screen.getByLabelText('Hex value')
    fireEvent.change(hex, { target: { value: '#0ea5e9' } })
    expect(preview.style.getPropertyValue('--accent')).toBe('#0ea5e9')
    fireEvent.change(hex, { target: { value: 'nonsense' } })
    expect(preview.style.getPropertyValue('--accent')).toBe('#0ea5e9')
  })

  it('per-knob reset restores the default and hides the reset affordance', () => {
    renderAppearance()
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

  it('"Reset all" returns every knob to its default', () => {
    renderAppearance()
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sharp' }))
    fireEvent.click(screen.getByRole('button', { name: /reset all/i }))
    const preview = screen.getByTestId('cz-preview')
    expect(preview.style.getPropertyValue('--measure-page')).toBe('64rem')
    expect(preview.style.getPropertyValue('--radius-base')).toBe('10px')
  })

  it('remembers choices across remount (localStorage)', () => {
    const { unmount } = renderAppearance()
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    unmount()
    renderAppearance()
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
    renderAppearance(services)
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
    renderAppearance(services)
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
    renderAppearance(services)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Published' })).toBeDisabled()
    )
  })
})
