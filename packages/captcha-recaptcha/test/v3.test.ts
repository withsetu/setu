import { describe, it, expect } from 'vitest'
import { runCaptchaPortContract } from '@setu/db-testing'
import { createRecaptchaV3Captcha } from '../src/index'

// v3 satisfies the shared CaptchaPort contract: the contract's `{ success: true }` fixture has
// no `score`, and a score-less response is treated as passing (threshold only bites when the
// provider actually returns a score — a real v3 response always does).
runCaptchaPortContract((fetchImpl) =>
  createRecaptchaV3Captcha({ secret: 'secret', fetchImpl })
)

const fakeFetch =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status })

describe('reCAPTCHA v3 — score threshold', () => {
  it('passes when score >= the default threshold (0.5)', async () => {
    const c = createRecaptchaV3Captcha({
      secret: 's',
      fetchImpl: fakeFetch({ success: true, score: 0.7, action: 'submit' })
    })
    expect(await c.verify('tok')).toBe(true)
  })

  it('fails a low score even when success is true (bot-likely)', async () => {
    const c = createRecaptchaV3Captcha({
      secret: 's',
      fetchImpl: fakeFetch({ success: true, score: 0.2, action: 'submit' })
    })
    expect(await c.verify('tok')).toBe(false)
  })

  it('honors a custom minScore', async () => {
    const c = createRecaptchaV3Captcha({
      secret: 's',
      minScore: 0.9,
      fetchImpl: fakeFetch({ success: true, score: 0.7 })
    })
    expect(await c.verify('tok')).toBe(false)
  })

  it('treats the score-boundary as inclusive (score === minScore passes)', async () => {
    const c = createRecaptchaV3Captcha({
      secret: 's',
      minScore: 0.5,
      fetchImpl: fakeFetch({ success: true, score: 0.5 })
    })
    expect(await c.verify('tok')).toBe(true)
  })
})

describe('reCAPTCHA v3 — action binding (optional)', () => {
  it('requires the returned action to match when an expected action is configured', async () => {
    const c = createRecaptchaV3Captcha({
      secret: 's',
      action: 'submit',
      fetchImpl: fakeFetch({ success: true, score: 0.9, action: 'login' })
    })
    // High score but wrong action → a replayed token from another action → reject.
    expect(await c.verify('tok')).toBe(false)
  })

  it('passes when the configured action matches', async () => {
    const c = createRecaptchaV3Captcha({
      secret: 's',
      action: 'submit',
      fetchImpl: fakeFetch({ success: true, score: 0.9, action: 'submit' })
    })
    expect(await c.verify('tok')).toBe(true)
  })

  it('ignores action when none is configured', async () => {
    const c = createRecaptchaV3Captcha({
      secret: 's',
      fetchImpl: fakeFetch({ success: true, score: 0.9, action: 'anything' })
    })
    expect(await c.verify('tok')).toBe(true)
  })
})
