import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  resolveSetuMode,
  resolveAuthSecret,
  resolveRateLimitOverrides,
  resolvePreviewEnabled
} from '../src/config'

describe('resolveSetuMode', () => {
  it('defaults to self-hosted when SETU_MODE is unset — fail closed', () => {
    expect(resolveSetuMode({})).toBe('self-hosted')
  })

  it('passes through an explicit "local"', () => {
    expect(resolveSetuMode({ SETU_MODE: 'local' })).toBe('local')
  })

  it('passes through an explicit "self-hosted"', () => {
    expect(resolveSetuMode({ SETU_MODE: 'self-hosted' })).toBe('self-hosted')
  })

  it('treats any other/garbage value as self-hosted — fail closed', () => {
    expect(resolveSetuMode({ SETU_MODE: 'production' })).toBe('self-hosted')
  })
})

describe('resolveAuthSecret', () => {
  it('returns the configured secret when SETU_AUTH_SECRET is set, regardless of mode', () => {
    expect(
      resolveAuthSecret({
        SETU_AUTH_SECRET: 'configured-secret'
      })
    ).toBe('configured-secret')
  })

  it('falls back to an ephemeral secret when SETU_MODE=local and no SETU_AUTH_SECRET is set', () => {
    const secret = resolveAuthSecret({
      SETU_MODE: 'local'
    })
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns null (does NOT throw) when SETU_MODE is unset and no SETU_AUTH_SECRET is set — fail-closed DEGRADATION, not a boot crash (regression: unset must not be treated as local)', () => {
    expect(resolveAuthSecret({})).toBeNull()
  })

  it('returns null (does NOT throw) when SETU_MODE=self-hosted and no SETU_AUTH_SECRET is set', () => {
    expect(resolveAuthSecret({ SETU_MODE: 'self-hosted' })).toBeNull()
  })
})

describe('resolveRateLimitOverrides (#248 Task 9)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns {} (createAuth applies its own defaults) when neither env var is set', () => {
    expect(resolveRateLimitOverrides({})).toEqual({})
  })

  it('parses valid positive-int overrides for both window and max', () => {
    expect(
      resolveRateLimitOverrides({
        SETU_AUTH_RATELIMIT_WINDOW: '30',
        SETU_AUTH_RATELIMIT_MAX: '5'
      })
    ).toEqual({ window: 30, max: 5 })
  })

  it('parses just one of the two when only one is set', () => {
    expect(
      resolveRateLimitOverrides({
        SETU_AUTH_RATELIMIT_WINDOW: '120'
      })
    ).toEqual({ window: 120 })
    expect(
      resolveRateLimitOverrides({
        SETU_AUTH_RATELIMIT_MAX: '10'
      })
    ).toEqual({ max: 10 })
  })

  it('warns and falls back to unset (no override, createAuth default applies) for a non-numeric value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      resolveRateLimitOverrides({
        SETU_AUTH_RATELIMIT_WINDOW: 'not-a-number'
      })
    ).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  it('warns and falls back to unset for zero (not a positive int)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      resolveRateLimitOverrides({
        SETU_AUTH_RATELIMIT_MAX: '0'
      })
    ).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  it('warns and falls back to unset for a negative number', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      resolveRateLimitOverrides({
        SETU_AUTH_RATELIMIT_WINDOW: '-5'
      })
    ).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  it('warns and falls back to unset for a non-integer (float)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      resolveRateLimitOverrides({
        SETU_AUTH_RATELIMIT_MAX: '3.5'
      })
    ).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  it('never throws regardless of garbage input', () => {
    expect(() =>
      resolveRateLimitOverrides({
        SETU_AUTH_RATELIMIT_WINDOW: '',
        SETU_AUTH_RATELIMIT_MAX: 'NaN'
      })
    ).not.toThrow()
  })

  it('disables the limiter ONLY for an explicit SETU_AUTH_RATELIMIT_ENABLED=false (e2e lane)', () => {
    expect(
      resolveRateLimitOverrides({
        SETU_AUTH_RATELIMIT_ENABLED: 'false'
      })
    ).toEqual({
      enabled: false
    })
  })

  it('leaves the limiter ON (no enabled key) for any other value of the flag, including unset', () => {
    // Fail-safe: only the literal string 'false' disables it — 'true'/'0'/'no'/unset all leave the
    // limiter at createAuth's default-on, so a typo can never silently open the door in production.
    expect(resolveRateLimitOverrides({})).toEqual({})
    expect(
      resolveRateLimitOverrides({
        SETU_AUTH_RATELIMIT_ENABLED: 'true'
      })
    ).toEqual({})
    expect(
      resolveRateLimitOverrides({
        SETU_AUTH_RATELIMIT_ENABLED: '0'
      })
    ).toEqual({})
  })
})

// #627 — the in-editor preview slot is an UNAUTHENTICATED read/write surface. It used to be gated
// on `NODE_ENV !== 'production'` alone, but `apps/api`'s own `start` script sets no NODE_ENV and
// nothing else in the repo sets it for the API process — so the DEFAULT self-hosted boot mounted
// it. Env-var-absent must mean locked, exactly as resolveSetuMode already does.
describe('resolvePreviewEnabled', () => {
  it('is DISABLED when nothing is set — the default self-hosted boot (regression #627)', () => {
    expect(resolvePreviewEnabled({})).toBe(false)
  })

  it('is DISABLED in self-hosted mode even outside production', () => {
    expect(
      resolvePreviewEnabled({
        SETU_MODE: 'self-hosted',
        NODE_ENV: 'development'
      })
    ).toBe(false)
  })

  it('is ENABLED only in local mode outside production', () => {
    expect(resolvePreviewEnabled({ SETU_MODE: 'local' })).toBe(true)
    expect(
      resolvePreviewEnabled({ SETU_MODE: 'local', NODE_ENV: 'development' })
    ).toBe(true)
  })

  it('is DISABLED in local mode when NODE_ENV=production', () => {
    expect(
      resolvePreviewEnabled({ SETU_MODE: 'local', NODE_ENV: 'production' })
    ).toBe(false)
  })
})
