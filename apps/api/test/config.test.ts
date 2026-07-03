import { describe, expect, it } from 'vitest'
import { resolveSetuMode, resolveAuthSecret } from '../src/config'

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

  it('THROWS when SETU_MODE is unset and no SETU_AUTH_SECRET is set — fail closed (regression: unset must not be treated as local)', () => {
    expect(() => resolveAuthSecret({} as NodeJS.ProcessEnv)).toThrow(/SETU_AUTH_SECRET is required/)
  })

  it('throws when SETU_MODE=self-hosted and no SETU_AUTH_SECRET is set', () => {
    expect(() => resolveAuthSecret({ SETU_MODE: 'self-hosted' } as NodeJS.ProcessEnv)).toThrow(
      /SETU_AUTH_SECRET is required/,
    )
  })
})
