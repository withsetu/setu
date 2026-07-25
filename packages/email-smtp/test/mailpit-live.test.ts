import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createSmtpEmailAdapter } from '../src/index'

/** Live round-trip against a real Mailpit SMTP sink (the contract target named
 *  on #256): send through the adapter over an actual socket, then assert via
 *  Mailpit's REST API that the identifying fields arrived intact. Auto-skips
 *  when the mailpit binary isn't installed (`brew install mailpit`), so CI
 *  without it stays green — #454 owns wiring Mailpit into CI. Non-default
 *  ports to avoid colliding with a developer's own Mailpit on :1025/:8025. */
const SMTP_HOST = '127.0.0.1'
const SMTP_PORT = 11025
const HTTP_BASE = 'http://127.0.0.1:18025'

const hasMailpit = (() => {
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
