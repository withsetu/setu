import { describe, it, expect } from 'vitest'
import type { EmailPort, EmailMessage } from '@setu/core'

/** Everything an adapter needs to expose so the EmailPort contract can drive it.
 *  Adapters wire their (injected) transport into this harness so the runner stays
 *  provider-agnostic — it never imports resend, console, etc. */
export interface EmailContractHarness {
  /** The adapter under test, whose transport forwards into `outbound()`. */
  adapter: EmailPort
  /** One stringified record per message the adapter forwarded to its transport,
   *  in send order. Stringified because each provider forwards a different shape
   *  (a log line, a JSON body, …); the contract only asserts the identifying
   *  fields survived the hop. */
  outbound(): string[]
  /** A sibling adapter of the SAME kind whose transport fails, used to prove
   *  `send()` surfaces (rejects on) a downstream failure rather than swallowing it. */
  failing: EmailPort
}

/** A recognisable body marker present in BOTH `html` and `text` so the assertion
 *  holds whether an adapter forwards the html, the text, or both. */
const BODY_MARK = 'setu-contract-body-marker'

const fullMessage = (): EmailMessage => ({
  to: 'recipient@setu.test',
  from: 'site@setu.test',
  subject: 'Contract subject',
  html: `<p>${BODY_MARK}</p>`,
  text: BODY_MARK
})

/** Same message minus the optional plaintext alternative. */
const htmlOnlyMessage = (): EmailMessage => {
  const { text: _text, ...rest } = fullMessage()
  return rest
}

/** Run the EmailPort behavioural contract against an adapter. `makeHarness` must
 *  return a FRESH harness (empty `outbound`) on each call. Every EmailPort adapter
 *  must pass this suite. */
export function runEmailPortContract(
  makeHarness: () => EmailContractHarness
): void {
  describe('EmailPort contract', () => {
    it('forwards nothing before send is called', () => {
      expect(makeHarness().outbound()).toEqual([])
    })

    it('resolves for a valid message and forwards its identifying fields', async () => {
      const h = makeHarness()
      const msg = fullMessage()
      await expect(h.adapter.send(msg)).resolves.toBeUndefined()

      const out = h.outbound()
      expect(out).toHaveLength(1)
      expect(out[0]).toContain(msg.to)
      expect(out[0]).toContain(msg.from)
      expect(out[0]).toContain(msg.subject)
      expect(out[0]).toContain(BODY_MARK)
    })

    it('resolves for a message without the optional text field', async () => {
      const h = makeHarness()
      const msg = htmlOnlyMessage()
      await expect(h.adapter.send(msg)).resolves.toBeUndefined()

      const out = h.outbound()
      expect(out).toHaveLength(1)
      // With no text alternative the html body must still reach the transport.
      expect(out[0]).toContain(BODY_MARK)
      expect(out[0]).toContain(msg.to)
    })

    it('forwards each message once, preserving send order', async () => {
      const h = makeHarness()
      const a: EmailMessage = { ...fullMessage(), subject: 'first-subject' }
      const b: EmailMessage = { ...fullMessage(), subject: 'second-subject' }
      await h.adapter.send(a)
      await h.adapter.send(b)

      const out = h.outbound()
      expect(out).toHaveLength(2)
      expect(out[0]).toContain('first-subject')
      expect(out[1]).toContain('second-subject')
    })

    it('surfaces a transport failure by rejecting', async () => {
      const h = makeHarness()
      await expect(h.failing.send(fullMessage())).rejects.toThrow()
    })
  })
}
