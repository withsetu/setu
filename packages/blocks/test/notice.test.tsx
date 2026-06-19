import { render } from '@testing-library/react'
import { Notice } from '../src/notice/Notice'

test('renders the tone class, optional title, and body', () => {
  const { container } = render(
    <Notice tone="success" title="Good news">
      <p>Body text</p>
    </Notice>,
  )
  const aside = container.querySelector('aside.notice.notice-success')
  expect(aside).toBeTruthy()
  expect(container.querySelector('.notice-title')?.textContent).toBe('Good news')
  expect(container.querySelector('.notice-body')?.textContent).toBe('Body text')
})

test('omits the title when not provided and defaults the tone to info', () => {
  const { container } = render(<Notice><span /></Notice>)
  expect(container.querySelector('aside.notice.notice-info')).toBeTruthy()
  expect(container.querySelector('.notice-title')).toBeNull()
})
