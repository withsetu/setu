import { describe, it, expect } from 'vitest'
import { evaluateLock } from '../../src/authoring/lock-policy'
import type { Lock } from '../../src/index'

const lock = (lockedBy: string, lockedAt: number): Lock => ({
  collection: 'post',
  locale: 'en',
  slug: 'x',
  lockedBy,
  lockedAt,
})
const TTL = 1000

describe('evaluateLock', () => {
  it('acquires when there is no lock', () => {
    expect(evaluateLock(null, 'a@x.com', 5000, TTL)).toBe('acquire')
  })
  it('refreshes when the same editor holds it', () => {
    expect(evaluateLock(lock('a@x.com', 4500), 'a@x.com', 5000, TTL)).toBe('refresh')
  })
  it('refreshes even when the same editor holds a stale lock (same-editor wins over staleness)', () => {
    // age 2000 > ttl 1000, but the same editor holds it → refresh, not takeover
    expect(evaluateLock(lock('a@x.com', 3000), 'a@x.com', 5000, TTL)).toBe('refresh')
  })
  it('takes over when another editor holds a stale lock', () => {
    // age 2000 > ttl 1000
    expect(evaluateLock(lock('b@x.com', 3000), 'a@x.com', 5000, TTL)).toBe('takeover')
  })
  it('blocks when another editor holds a fresh lock', () => {
    // age 500 <= ttl 1000
    expect(evaluateLock(lock('b@x.com', 4500), 'a@x.com', 5000, TTL)).toBe('blocked')
  })
  it('treats age === ttl as fresh (not a takeover)', () => {
    // age exactly 1000, strict > means not stale
    expect(evaluateLock(lock('b@x.com', 4000), 'a@x.com', 5000, TTL)).toBe('blocked')
  })
})
