import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createSmtpEmailAdapter } from '../src/index'

/** Live round-trip against a real Mailpit SMTP sink (the contract target named
 *  on #256): send through the adapter over an actual socket, then assert via
 *  Mailpit's REST API that the identifying fields arrived intact.
 *
 *  Two ways to get a Mailpit (#1202):
 *   - CI: the `check` job runs Mailpit as a service container mapped to the
 *     ports below and sets SETU_TEST_MAILPIT=1. With that set the suite uses the
 *     running instance and FAILS (never skips) if it is unreachable, so CI cannot
 *     go green on a silently skipped live test.
 *   - Locally: if the `mailpit` binary is installed (`brew install mailpit`) the
 *     suite spawns its own on these non-default ports, avoiding a developer's own
 *     Mailpit on :1025/:8025. With neither, it skips. */
const SMTP_HOST = '127.0.0.1'
const SMTP_PORT = 11025
const HTTP_BASE = 'http://127.0.0.1:18025'

/** A Mailpit is already listening on the ports above (CI's service container). */
const external = process.env.SETU_TEST_MAILPIT === '1'

const hasMailpit = (() => {
  if (external) return true
  try {
    return spawnSync('mailpit', ['version'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
})()

async function waitForMailpit(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const res = await fetch(`${HTTP_BASE}/api/v1/messages`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('mailpit did not become ready')
    await new Promise((r) => setTimeout(r, 200))
  }
}

describe.skipIf(!hasMailpit)('smtp adapter → live Mailpit round-trip', () => {
  let mailpit: ChildProcess | undefined

  beforeAll(async () => {
    // In-memory store (no --db-file): each run starts empty and leaves nothing.
    if (!external)
      mailpit = spawn(
        'mailpit',
        ['--smtp', `${SMTP_HOST}:${SMTP_PORT}`, '--listen', '127.0.0.1:18025'],
        { stdio: 'ignore' }
      )
    await waitForMailpit()
  }, 30000)

  afterAll(() => {
    mailpit?.kill()
  })

  it('delivers to/from/subject/html/text intact through a real SMTP hop', async () => {
    const subject = `setu-smtp-live-${Date.now()}`
    const adapter = createSmtpEmailAdapter({ host: SMTP_HOST, port: SMTP_PORT })
    await adapter.send({
      to: 'recipient@setu.test',
      from: 'site@setu.test',
      subject,
      html: '<p>setu-live-body-marker</p>',
      text: 'setu-live-body-marker'
    })

    const list = (await (
      await fetch(`${HTTP_BASE}/api/v1/messages`)
    ).json()) as {
      messages: { ID: string; Subject: string }[]
    }
    const hit = list.messages.find((m) => m.Subject === subject)
    expect(
      hit,
      'message with our unique subject captured by Mailpit'
    ).toBeDefined()

    const full = (await (
      await fetch(`${HTTP_BASE}/api/v1/message/${hit!.ID}`)
    ).json()) as {
      Subject: string
      From: { Address: string }
      To: { Address: string }[]
      HTML: string
      Text: string
    }
    expect(full.Subject).toBe(subject)
    expect(full.From.Address).toBe('site@setu.test')
    expect(full.To.map((t) => t.Address)).toContain('recipient@setu.test')
    expect(full.HTML).toContain('<p>setu-live-body-marker</p>')
    expect(full.Text).toContain('setu-live-body-marker')
  })
})
