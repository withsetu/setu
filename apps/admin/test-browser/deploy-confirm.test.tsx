import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { page, userEvent } from '@vitest/browser/context'
import type { DeployStatus } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { SidebarProvider } from '@/components/ui/sidebar'
import { DeployControl } from '../src/deploy/DeployControl'
// Real app CSS: the progress overlay is positioned by Tailwind utilities and animated
// by the `deploy-progress-sweep` keyframes in styles/components.css. Without the real
// stylesheet the bar would measure 0×0 — which is precisely what this file asserts
// against, so the stylesheet has to be the app's own, not a stub.
import '../src/index.css'

// ---------------------------------------------------------------------------------
// Real-browser cover for the deploy confirmation (#571). The jsdom suite
// (test/deploy-control.test.tsx) proves the copy and the wiring, but the parts that
// make the affordance TRUSTWORTHY are exactly the jsdom-blind class (CLAUDE.md
// failure mode #3): Radix AlertDialog renders through a PORTAL with a focus trap, so
// "Escape cancels", "focus lands inside the dialog", and "the progress bar actually
// paints with a non-zero box" can only be observed in a real browser with real
// layout and real focus management.
// ---------------------------------------------------------------------------------

const state: {
  status: DeployStatus | null
  running: boolean
  startedAt: number | null
  confirmOpen: boolean
} = { status: null, running: false, startedAt: null, confirmOpen: false }

const closeConfirm = vi.fn(() => {
  state.confirmOpen = false
})
const rebuild = vi.fn(() => Promise.resolve())

vi.mock('../src/deploy/deploy', () => ({
  useDeploy: () => ({
    status: state.status,
    deployInfo: () => ({ deployedSha: null, changed: [] }),
    refresh: () => Promise.resolve(),
    rebuild,
    running: state.running,
    startedAt: state.startedAt,
    confirmOpen: state.confirmOpen,
    requestRebuild: () => {
      state.confirmOpen = true
    },
    closeConfirm
  })
}))

const baseStatus: DeployStatus = {
  deployedSha: 'abc1234def',
  deployedAt: '2026-07-09T00:00:00.000Z',
  headSha: 'head',
  pending: true,
  changedPaths: [{ path: 'content/post/en/a.mdoc', added: false }],
  job: null,
  canRebuild: true
}

function mount() {
  return render(
    <ActorProvider>
      <NotificationProvider>
        <SidebarProvider>
          <DeployControl />
        </SidebarProvider>
      </NotificationProvider>
    </ActorProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  state.status = { ...baseStatus }
  state.running = false
  state.startedAt = null
  state.confirmOpen = false
})

afterEach(cleanup)

describe('deploy confirmation in a real browser (#571)', () => {
  it('portals the dialog, moves focus into it, and Escape cancels without deploying', async () => {
    state.confirmOpen = true
    mount()

    const dialog = page.getByRole('alertdialog')
    await expect.element(dialog).toBeInTheDocument()
    // Portalled: it is NOT inside the sidebar control's subtree.
    const dialogEl = dialog.element()
    expect(
      document.querySelector('[data-slot="sidebar-menu-button"]')
    ).not.toBe(null)
    expect(
      document
        .querySelector('[data-slot="sidebar-menu-button"]')
        ?.contains(dialogEl)
    ).toBe(false)

    // Focus trap put the caret inside the dialog — keyboard users are not stranded.
    expect(dialogEl.contains(document.activeElement)).toBe(true)

    await userEvent.keyboard('{Escape}')
    expect(closeConfirm).toHaveBeenCalled()
    expect(rebuild).not.toHaveBeenCalled()
  })

  it('confirming with the keyboard alone starts the build', async () => {
    state.confirmOpen = true
    mount()
    await expect.element(page.getByRole('alertdialog')).toBeInTheDocument()
    const action = page.getByRole('button', { name: 'Publish now' })
    await expect.element(action).toBeInTheDocument()
    ;(action.element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    expect(rebuild).toHaveBeenCalledOnce()
  })

  it('paints a real progress bar inside the button while a build runs', async () => {
    state.running = true
    state.startedAt = Date.now() - 3000
    mount()
    const btn = page.getByRole('button', { name: 'Publish site' })
    await expect.element(btn).toBeDisabled()
    const bar = btn.element().querySelector('[data-slot="deploy-progress"]')
    expect(bar).not.toBeNull()
    const box = (bar as HTMLElement).getBoundingClientRect()
    expect(box.width).toBeGreaterThan(0)
    expect(box.height).toBeGreaterThan(0)
    // The sweep itself is a real, laid-out child — not a class name that resolves to nothing.
    const sweep = (bar as HTMLElement).querySelector('.deploy-progress-sweep')
    expect(sweep).not.toBeNull()
    expect(
      (sweep as HTMLElement).getBoundingClientRect().width
    ).toBeGreaterThan(0)
  })
})
