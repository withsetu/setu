import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Icon, isIconName } from '../src/ui/Icon'
import { registry } from '../src/blocks/registry'

describe('Icon', () => {
  it('renders an svg for a known icon name', () => {
    const { container } = render(<Icon name="dashboard" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.innerHTML.length).toBeGreaterThan(0)
  })

  it('renders the column-alignment icons', () => {
    for (const name of ['alignLeft', 'alignCenter', 'alignRight'] as const) {
      expect(isIconName(name)).toBe(true)
      const { container } = render(<Icon name={name} />)
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg!.innerHTML.length).toBeGreaterThan(0)
    }
  })

  it('renders the row/column action icons', () => {
    for (const name of [
      'rowAdd',
      'rowDelete',
      'columnAdd',
      'columnDelete'
    ] as const) {
      expect(isIconName(name)).toBe(true)
      const { container } = render(<Icon name={name} />)
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg!.innerHTML.length).toBeGreaterThan(0)
    }
  })

  it('renders nothing for an unknown name', () => {
    // @ts-expect-error — exercising the runtime guard for an invalid name
    const { container } = render(<Icon name="not-an-icon" />)
    expect(container.querySelector('svg')).toBeNull()
  })
})

// #1249: a block's `editor.icon` is free text in its contract, and `toIconName`
// (src/editor/blocks.ts) silently falls back to a sparkle for an unknown name — so a typo
// (embed shipped `'movie'`) never failed anything. Every registry block that declares an
// icon must name one that exists.
describe('block editor icons', () => {
  it('every registry block declaring an editor icon names a known icon', () => {
    const declared = registry.blocks.filter((b) => b.editor?.icon !== undefined)
    // Anti-vacuity: the registry really carries icons to check.
    expect(declared.length).toBeGreaterThan(5)
    const unknown = declared
      .filter((b) => !isIconName(b.editor!.icon!))
      .map((b) => `${b.tag}: '${b.editor!.icon}'`)
    expect(unknown).toEqual([])
  })
})
