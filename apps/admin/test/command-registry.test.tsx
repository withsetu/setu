import { render, screen, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useEffect, useState } from 'react'
import { CommandRegistryProvider, useCommandRegistry, useRegisterCommands, type CommandAction } from '../src/command/registry'

function Probe() {
  const { commands } = useCommandRegistry()
  return <div data-testid="ids">{commands.map((c) => c.id).join(',')}</div>
}
const act1: CommandAction = { id: 'a', title: 'Alpha', group: 'G', run: () => {} }

function Registrar({ actions }: { actions: CommandAction[] }) {
  useRegisterCommands(actions)
  return null
}

describe('command registry', () => {
  it('registers actions on mount and exposes them', () => {
    render(<CommandRegistryProvider><Registrar actions={[act1]} /><Probe /></CommandRegistryProvider>)
    expect(screen.getByTestId('ids').textContent).toBe('a')
  })
  it('unregisters on unmount', () => {
    function Host() {
      const [on, setOn] = useState(true)
      useEffect(() => { setOn(false) }, []) // unmount the registrar after first paint
      return <>{on && <Registrar actions={[act1]} />}<Probe /></>
    }
    render(<CommandRegistryProvider><Host /></CommandRegistryProvider>)
    expect(screen.getByTestId('ids').textContent).toBe('')
  })
  it('run delegates to the latest closure (no stale capture)', () => {
    const calls: number[] = []
    function Counter() {
      const [n, setN] = useState(0)
      useEffect(() => { setN(5) }, [])
      useRegisterCommands([{ id: 'c', title: 'C', group: 'G', run: () => calls.push(n) }])
      return null
    }
    const { container } = render(<CommandRegistryProvider><Counter /><Probe /></CommandRegistryProvider>)
    // grab the registered action via a consumer and run it
    function Runner() { const { commands } = useCommandRegistry(); commands.find((c) => c.id === 'c')?.run(); return null }
    act(() => { render(<CommandRegistryProvider><Counter /><Runner /></CommandRegistryProvider>, { container }) })
    expect(calls.at(-1)).toBe(5)
  })
})
