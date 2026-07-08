import { describe, expect, it } from 'vitest'
import { resolveGitIdentity } from '../src/auth/git-identity'

describe('resolveGitIdentity', () => {
  it('resolves email/name via the injected exec function', () => {
    const identity = resolveGitIdentity({
      exec: (cmd) => {
        if (cmd === 'git config user.email') return 'ada@setu.dev\n'
        if (cmd === 'git config user.name') return 'Ada Lovelace\n'
        throw new Error(`unexpected command: ${cmd}`)
      }
    })
    expect(identity).toEqual({ email: 'ada@setu.dev', name: 'Ada Lovelace' })
  })

  it('falls back to owner@localhost/Owner when git config throws (no git / no config set)', () => {
    const identity = resolveGitIdentity({
      exec: () => {
        throw new Error('not a git repository')
      }
    })
    expect(identity).toEqual({ email: 'owner@localhost', name: 'Owner' })
  })

  it('falls back to owner@localhost/Owner when git config returns empty output', () => {
    const identity = resolveGitIdentity({ exec: () => '' })
    expect(identity).toEqual({ email: 'owner@localhost', name: 'Owner' })
  })

  it('falls back independently per field: email resolved, name empty -> name falls back only', () => {
    const identity = resolveGitIdentity({
      exec: (cmd) => (cmd === 'git config user.email' ? 'ada@setu.dev\n' : '')
    })
    expect(identity).toEqual({ email: 'ada@setu.dev', name: 'Owner' })
  })
})
