import { render } from '@testing-library/react'
import { BlockIcon } from '../src/icons/BlockIcon'
import { isBlockIconName } from '../src/icons/svgs'

test('renders an svg with the named icon inner markup', () => {
  const { container } = render(<BlockIcon name="check" />)
  const svg = container.querySelector('svg')
  expect(svg).toBeTruthy()
  expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
  expect(svg?.innerHTML).toContain('M20 6 9 17l-5-5')
})

test('isBlockIconName narrows known/unknown names', () => {
  expect(isBlockIconName('alert')).toBe(true)
  expect(isBlockIconName('definitely-not-an-icon')).toBe(false)
})
