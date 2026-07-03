import { describe, expect, it, vi, afterEach } from 'vitest'
import { resolveSetuMode, resolveAuthSecret, resolveRateLimitOverrides } from '../src/config'

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
    expect(resolveAuthSecret({ SETU_AUTH_SECRET: 'configured-secret' } as NodeJS.ProcessEnv)).toBe(
      'configured-secret',
    )
  })

  it('falls back to an ephemeral secret when SETU_MODE=local and no SETU_AUTH_SECRET is set', () => {
    const secret = resolveAuthSecret({ SETU_MODE: 'local' } as NodeJS.ProcessEnv)
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns null (does NOT throw) when SETU_MODE is unset and no SETU_AUTH_SECRET is set — fail-closed DEGRADATION, not a boot crash (regression: unset must not be treated as local)', () => {
    expect(resolveAuthSecret({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('returns null (does NOT throw) when SETU_MODE=self-hosted and no SETU_AUTH_SECRET is set', () => {
    expect(resolveAuthSecret({ SETU_MODE: 'self-hosted' } as NodeJS.ProcessEnv)).toBeNull()
  })
})

describe('resolveRateLimitOverrides (#248 Task 9)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns {} (createAuth applies its own defaults) when neither env var is set', () => {
    expect(resolveRateLimitOverrides({} as NodeJS.ProcessEnv)).toEqual({})
  })

  it('parses valid positive-int overrides for both window and max', () => {
    expect(
      resolveRateLimitOverrides({ SETU_AUTH_RATELIMIT_WINDOW: '30', SETU_AUTH_RATELIMIT_MAX: '5' } as NodeJS.ProcessEnv),
    ).toEqual({ window: 30, max: 5 })
  })

  it('parses just one of the two when only one is set', () => {
    expect(resolveRateLimitOverrides({ SETU_AUTH_RATELIMIT_WINDOW: '120' } as NodeJS.ProcessEnv)).toEqual({ window: 120 })
    expect(resolveRateLimitOverrides({ SETU_AUTH_RATELIMIT_MAX: '10' } as NodeJS.ProcessEnv)).toEqual({ max: 10 })
  })

  it('warns and falls back to unset (no override, createAuth default applies) for a non-numeric value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveRateLimitOverrides({ SETU_AUTH_RATELIMIT_WINDOW: 'not-a-number' } as NodeJS.ProcessEnv)).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  it('warns and falls back to unset for zero (not a positive int)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveRateLimitOverrides({ SETU_AUTH_RATELIMIT_MAX: '0' } as NodeJS.ProcessEnv)).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  it('warns and falls back to unset for a negative number', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveRateLimitOverrides({ SETU_AUTH_RATELIMIT_WINDOW: '-5' } as NodeJS.ProcessEnv)).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  it('warns and falls back to unset for a non-integer (float)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveRateLimitOverrides({ SETU_AUTH_RATELIMIT_MAX: '3.5' } as NodeJS.ProcessEnv)).toEqual({})
    expect(warn).toHaveBeenCalled()
  })

  it('never throws regardless of garbage input', () => {
    expect(() =>
      resolveRateLimitOverrides({ SETU_AUTH_RATELIMIT_WINDOW: '', SETU_AUTH_RATELIMIT_MAX: 'NaN' } as NodeJS.ProcessEnv),
    ).not.toThrow()
  })
})
