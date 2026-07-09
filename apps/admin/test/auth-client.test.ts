import { describe, it, expect } from 'vitest'
import { authClient, useSession } from '../src/auth/auth-client'

describe('authClient', () => {
  it('exposes the email/password + social sign-in and sign-out actions', () => {
    expect(typeof authClient.signIn.email).toBe('function')
    expect(typeof authClient.signIn.social).toBe('function')
    expect(typeof authClient.signOut).toBe('function')
  })

  it('exposes admin-plugin actions (needed by Task 8 user management)', () => {
    expect(authClient.admin).toBeDefined()
  })

  it('re-exports useSession as the client hook', () => {
    expect(useSession).toBe(authClient.useSession)
  })
})
