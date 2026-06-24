import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CommandRegistryProvider, useRegisterCommands, type CommandAction } from '../src/command/registry'
import { CommandPalette } from '../src/command/CommandPalette'

// jsdom stubs required by cmdk / Radix:
// - scrollIntoView: cmdk virtual list
// - ResizeObserver: cmdk uses it internally
// - PointerEvent: cmdk pointer interactions
beforeAll(() => {
  if (typeof window !== 'undefined') {
    window.HTMLElement.prototype.scrollIntoView = vi.fn()

    // cmdk uses ResizeObserver internally
    if (!window.ResizeObserver) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    }

    // cmdk uses PointerEvent which may not exist in jsdom
    if (!window.PointerEvent) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).PointerEvent = class PointerEvent extends MouseEvent {
        constructor(type: string, init?: PointerEventInit) {
          super(type, init)
        }
      }
    }
  }
})

afterEach(cleanup)

/** Seeds three actions across two groups; one is disabled. */
function Registrar() {
  useRegisterCommands([
    { id: 'create-post', title: 'Alpha', group: 'Create', run: vi.fn(), keywords: 'new post' },
    { id: 'go-home', title: 'Beta', group: 'Go to', run: vi.fn() },
    { id: 'disabled-action', title: 'Gamma', group: 'Editor', run: vi.fn(), enabled: () => false },
  ])
  return null
}

function setup() {
  const runSpies: Record<string, ReturnType<typeof vi.fn>> = {}
  const runAlpha = vi.fn()
  const runBeta = vi.fn()

  function RegistrarWithSpies() {
    useRegisterCommands([
      { id: 'create-post', title: 'Alpha', group: 'Create', run: runAlpha, keywords: 'new post' },
      { id: 'go-home', title: 'Beta', group: 'Go to', run: runBeta },
      { id: 'disabled-action', title: 'Gamma', group: 'Editor', run: vi.fn(), enabled: () => false },
    ])
    return null
  }

  render(
    <CommandRegistryProvider>
      <RegistrarWithSpies />
      <CommandPalette />
    </CommandRegistryProvider>,
  )

  runSpies['alpha'] = runAlpha
  runSpies['beta'] = runBeta
  return runSpies
}

describe('CommandPalette', () => {
  it('⌘K opens the dialog (CommandInput visible)', () => {
    setup()
    expect(screen.queryByRole('combobox')).toBeNull()

    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('⌘⇧P also opens the dialog', () => {
    setup()
    expect(screen.queryByRole('combobox')).toBeNull()

    fireEvent.keyDown(window, { key: 'P', code: 'KeyP', metaKey: true, shiftKey: true })

    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('disabled action (enabled: () => false) is NOT rendered', () => {
    setup()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    // Enabled actions should be present
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    // Disabled action should not appear
    expect(screen.queryByText('Gamma')).toBeNull()
  })

  it('groups render under their headings', () => {
    setup()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    // Group headings from cmdk appear as text
    expect(screen.getByText('Create')).toBeInTheDocument()
    expect(screen.getByText('Go to')).toBeInTheDocument()
  })

  it('selecting an item calls its run and closes the dialog', () => {
    const spies = setup()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    // Confirm dialog is open
    expect(screen.getByRole('combobox')).toBeInTheDocument()

    // Click on the Alpha item to select it
    fireEvent.click(screen.getByText('Alpha'))

    // run should have been called
    expect(spies['alpha']).toHaveBeenCalledOnce()

    // Dialog should be closed (CommandInput gone)
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
