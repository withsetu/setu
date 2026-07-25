import { describe, it, expect, vi } from 'vitest'
import {
  createWindowLimiter,
  createNotifyCeiling,
  boundFromEnv
} from '../src/rate-limit'

describe('createWindowLimiter (#918 — extracted from email.ts, #885)', () => {
  it('allows up to `max` inside the window, then refuses', () => {
    const l = createWindowLimiter({ max: 3, windowMs: 60_000, now: () => 0 })
    for (let i = 0; i < 3; i++) {
      expect(l.check('a')).toBe(true)
      l.record('a')
    }
    expect(l.check('a')).toBe(false)
  })

  it('is per key — one key exhausting its quota does not touch another', () => {
    const l = createWindowLimiter({ max: 1, windowMs: 60_000, now: () => 0 })
    l.record('a')
    expect(l.check('a')).toBe(false)
    expect(l.check('b')).toBe(true)
  })

  it('slides: stamps older than the window stop counting', () => {
    let t = 0
    const l = createWindowLimiter({ max: 2, windowMs: 1_000, now: () => t })
    l.record('a')
    l.record('a')
    expect(l.check('a')).toBe(false)
    t = 999
    expect(l.check('a')).toBe(false) // still inside the window
    t = 1_000
    expect(l.check('a')).toBe(true) // both stamps aged out
  })

  it('check() never consumes — only record() does', () => {
    const l = createWindowLimiter({ max: 1, windowMs: 60_000, now: () => 0 })
    expect(l.check('a')).toBe(true)
    expect(l.check('a')).toBe(true)
    expect(l.check('a')).toBe(true)
    l.record('a')
    expect(l.check('a')).toBe(false)
  })

  it('bounds its own memory: maxKeys evicts the least-recently-recorded key', () => {
    // The public /forms/submit route keys on an attacker-varied client IP, so an unbounded Map
    // would itself be the DoS. Eviction can only REMOVE a bucket (never grant extra quota to the
    // key that stays), and the notification ceiling below is the bound that does not depend on
    // key cardinality at all.
    const l = createWindowLimiter({
      max: 1,
      windowMs: 60_000,
      now: () => 0,
      maxKeys: 2
    })
    l.record('a')
    l.record('b')
    l.record('c') // evicts 'a', the least recently recorded
    expect(l.size).toBe(2)
    expect(l.check('a')).toBe(true) // forgotten, so it starts fresh
    expect(l.check('b')).toBe(false)
    expect(l.check('c')).toBe(false)
  })

  // #918 review F4 — the honest limit of eviction. An earlier comment claimed an attacker who
  // cycles addresses "still gets only max per address they use"; they do not, because they can
  // evict their OWN exhausted bucket. The only property eviction guarantees is that it forgets.
  it('eviction can forget the evicting callers OWN exhausted bucket', () => {
    const l = createWindowLimiter({
      max: 1,
      windowMs: 60_000,
      now: () => 0,
      maxKeys: 3
    })
    l.record('attacker')
    expect(l.check('attacker')).toBe(false) // exhausted
    // Reach maxKeys other keys — cheap for anyone who can vary a source address.
    l.record('a')
    l.record('b')
    l.record('c')
    expect(l.check('attacker')).toBe(true) // their own bucket was evicted; they start fresh
    expect(l.size).toBeLessThanOrEqual(3)
  })

  // #918 review F5 — fail-OPEN guard. `maxKeys: 0` would evict every key straight after
  // recording it, so every caller would be permanently fresh and the limiter would be off.
  it('clamps a non-positive maxKeys instead of silently disabling itself', () => {
    for (const maxKeys of [0, -1]) {
      const l = createWindowLimiter({
        max: 1,
        windowMs: 60_000,
        now: () => 0,
        maxKeys
      })
      l.record('a')
      expect(l.check('a'), `maxKeys ${maxKeys}`).toBe(false)
      expect(l.size, `maxKeys ${maxKeys}`).toBe(1)
    }
  })

  it('forgets a key whose stamps have all expired, without waiting for eviction', () => {
    let t = 0
    const l = createWindowLimiter({ max: 1, windowMs: 1_000, now: () => t })
    l.record('a')
    expect(l.size).toBe(1)
    t = 5_000
    expect(l.check('a')).toBe(true)
    expect(l.size).toBe(0)
  })
})

describe('createNotifyCeiling (#918 — the hard outbound-mail bound)', () => {
  it('allows `max` notifications per window, then returns a named skip reason', () => {
    const ceiling = createNotifyCeiling({
      max: 2,
      windowMs: 60_000,
      now: () => 0
    })
    expect(ceiling()).toBeNull()
    expect(ceiling()).toBeNull()
    const reason = ceiling()
    expect(reason).not.toBeNull()
    expect(reason).toContain('ceiling')
    expect(reason).toContain('the submission was saved')
  })

  it('does not depend on any caller identity — it is ONE bucket for the whole process', () => {
    // This is the property that makes it unbypassable: no header, IP or session feeds it, so
    // varying any of them cannot mint fresh quota.
    const ceiling = createNotifyCeiling({
      max: 1,
      windowMs: 60_000,
      now: () => 0
    })
    expect(ceiling()).toBeNull()
    expect(ceiling()).not.toBeNull()
    expect(ceiling()).not.toBeNull()
  })

  it('refills as the window slides', () => {
    let t = 0
    const ceiling = createNotifyCeiling({
      max: 1,
      windowMs: 1_000,
      now: () => t
    })
    expect(ceiling()).toBeNull()
    expect(ceiling()).not.toBeNull()
    t = 1_000
    expect(ceiling()).toBeNull()
  })

  it('names the env vars an operator would raise', () => {
    const ceiling = createNotifyCeiling({
      max: 1,
      windowMs: 60_000,
      now: () => 0
    })
    ceiling()
    expect(String(ceiling())).toContain('SETU_FORMS_NOTIFY_MAX_PER_WINDOW')
  })

  // #918 review F6 — the ceiling is also a cheap notification-SUPPRESSION primitive: sustained
  // low-rate traffic inside the per-IP bound keeps it saturated and the operator simply stops
  // getting mail. The per-skip reason alone is one line per submission, which is noise, not an
  // alert; this is the distinct once-per-window signal that notifications are OFF.
  describe('the saturation alert', () => {
    it('alerts once per window, not once per skip', () => {
      let t = 0
      const onSaturated = vi.fn()
      const ceiling = createNotifyCeiling({
        max: 1,
        windowMs: 1_000,
        now: () => t,
        onSaturated
      })

      expect(ceiling()).toBeNull() // consumes the only slot
      for (let i = 0; i < 20; i++) expect(ceiling()).not.toBeNull()
      expect(onSaturated).toHaveBeenCalledTimes(1) // 20 skips, ONE alert

      t = 1_000 // window slides: quota returns, one send, then saturated again
      expect(ceiling()).toBeNull()
      ceiling()
      expect(onSaturated).toHaveBeenCalledTimes(2)
    })

    it('says notifications are off, that submissions are still saved, and how to fix it', () => {
      const onSaturated = vi.fn()
      const ceiling = createNotifyCeiling({
        max: 1,
        windowMs: 60_000,
        now: () => 0,
        onSaturated
      })
      ceiling()
      ceiling()
      const alert = String(onSaturated.mock.calls[0]![0])
      expect(alert).toContain('SATURATED')
      expect(alert).toContain('still being saved')
      expect(alert).toContain('SETU_FORMS_NOTIFY_MAX_PER_WINDOW')
      expect(alert).toContain('SETU_CAPTCHA_PROVIDER')
    })

    it('never fires while the ceiling is allowing sends', () => {
      const onSaturated = vi.fn()
      const ceiling = createNotifyCeiling({
        max: 5,
        windowMs: 60_000,
        now: () => 0,
        onSaturated
      })
      for (let i = 0; i < 5; i++) expect(ceiling()).toBeNull()
      expect(onSaturated).not.toHaveBeenCalled()
    })
  })
})

describe('boundFromEnv (#918 — operator overrides, fail-closed)', () => {
  const names = { max: 'SETU_X_MAX', windowMs: 'SETU_X_WINDOW_MS' }
  const defaults = { max: 5, windowMs: 60_000 }

  it('uses the defaults when nothing is set', () => {
    expect(boundFromEnv({ raw: {}, defaults, names })).toEqual({
      max: 5,
      windowMs: 60_000,
      problems: []
    })
  })

  it('applies valid positive-integer overrides', () => {
    expect(
      boundFromEnv({ raw: { max: '11', windowMs: '30000' }, defaults, names })
    ).toEqual({ max: 11, windowMs: 30_000, problems: [] })
  })

  it('falls back to the DEFAULT (never to "unlimited") on an unparseable override, and says so', () => {
    const r = boundFromEnv({
      raw: { max: 'lots', windowMs: '0' },
      defaults,
      names
    })
    expect(r.max).toBe(5)
    expect(r.windowMs).toBe(60_000)
    expect(r.problems).toHaveLength(2)
    expect(r.problems[0]).toContain('SETU_X_MAX')
    expect(r.problems[1]).toContain('SETU_X_WINDOW_MS')
  })

  it('rejects a negative or fractional override rather than coercing it', () => {
    const r = boundFromEnv({
      raw: { max: '-1', windowMs: '1.5' },
      defaults,
      names
    })
    expect(r.max).toBe(5)
    expect(r.windowMs).toBe(60_000)
    expect(r.problems).toHaveLength(2)
  })

  it('never echoes an override value it could not parse back unquoted', () => {
    const r = boundFromEnv({ raw: { max: 'x y' }, defaults, names })
    expect(r.problems[0]).toContain(JSON.stringify('x y'))
  })
})

describe('createWindowLimiter — the test-send limiter it replaced (#885 parity)', () => {
  it('reproduces email.ts 3-per-60s behaviour exactly', () => {
    let t = 0
    const l = createWindowLimiter({ max: 3, windowMs: 60_000, now: () => t })
    const attempt = () => {
      if (!l.check('actor')) return 429
      l.record('actor')
      return 200
    }
    expect([attempt(), attempt(), attempt(), attempt()]).toEqual([
      200, 200, 200, 429
    ])
    t = 60_000
    expect(attempt()).toBe(200)
  })

  it('uses the injected clock, never the wall clock', () => {
    const now = vi.fn(() => 1234)
    const l = createWindowLimiter({ max: 1, windowMs: 10, now })
    l.check('a')
    expect(now).toHaveBeenCalled()
  })
})
