import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Icon, isIconName } from '../src/ui/Icon'

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

  it('renders nothing for an unknown name', () => {
    // @ts-expect-error — exercising the runtime guard for an invalid name
    const { container } = render(<Icon name="not-an-icon" />)
    expect(container.querySelector('svg')).toBeNull()
  })
})
