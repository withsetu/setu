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
