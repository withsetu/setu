import { runEmailPortContract } from '@setu/email-testing'
import { createConsoleEmailAdapter } from '../src/index'

runEmailPortContract(() => {
  const lines: string[] = []
  return {
    adapter: createConsoleEmailAdapter((line) => lines.push(line)),
    outbound: () => lines,
    // A console sink that throws proves send() surfaces a transport failure.
    failing: createConsoleEmailAdapter(() => {
      throw new Error('console sink down')
    })
  }
})
