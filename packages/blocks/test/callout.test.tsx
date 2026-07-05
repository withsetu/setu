import { render } from '@testing-library/react'
import { Callout } from '../src/callout/Callout'

test('renders the structure, tone class, icon badge, and slots in order', () => {
  const { container } = render(
    <Callout
      tone="amber"
      icon="alert"
      toolbar={<div data-testid="toolbar" />}
      title={<input className="callout-title" defaultValue="Heads up" />}
    >
      <div className="callout-body">Body</div>
    </Callout>
  )
  const aside = container.querySelector('aside.blk-callout.tone-amber')
  expect(aside).toBeTruthy()
  expect(aside?.firstElementChild).toBe(
    container.querySelector('[data-testid="toolbar"]')
  )
  expect(container.querySelector('.callout-head .callout-ic svg')).toBeTruthy()
  expect(
    container.querySelector('.callout-head input.callout-title')
  ).toBeTruthy()
  expect(
    container.querySelector('aside.blk-callout > .callout-body')?.textContent
  ).toBe('Body')
})

test('omits toolbar/title when not provided', () => {
  const { container } = render(
    <Callout tone="accent" icon="info">
      <div className="callout-body" />
    </Callout>
  )
  expect(container.querySelector('.callout-head input')).toBeNull()
})
