import type { EmailPort, EmailMessage } from '@setu/core'
import { runEmailPortContract, type EmailContractHarness } from '../src/index'

/** Minimal in-memory EmailPort — the reference the contract self-tests against.
 *  Captures each message so the harness can expose it as an `outbound()` record. */
function createMemoryEmail(): { adapter: EmailPort; sent: EmailMessage[] } {
  const sent: EmailMessage[] = []
  return {
    sent,
    adapter: {
      async send(msg) {
        sent.push(msg)
      }
    }
  }
}

runEmailPortContract((): EmailContractHarness => {
  const { adapter, sent } = createMemoryEmail()
  return {
    adapter,
    outbound: () => sent.map((m) => JSON.stringify(m)),
    failing: {
      async send() {
        throw new Error('memory transport down')
      }
    }
  }
})
