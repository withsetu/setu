import { describe, it, expect, vi } from 'vitest'
import { createConsoleEmailAdapter } from '../src/index'

describe('console email adapter', () => {
  it('logs the message and resolves', async () => {
    const log = vi.fn()
    const adapter = createConsoleEmailAdapter(log)
    await adapter.send({ to: 'me@x.com', from: 'site@x.com', subject: 'New', html: '<p>hi</p>' })
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0]![0])).toContain('me@x.com')
    expect(String(log.mock.calls[0]![0])).toContain('New')
  })
})
