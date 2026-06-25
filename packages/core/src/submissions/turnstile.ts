const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileVerifier = (token: string, remoteip?: string) => Promise<boolean>

/** Build a server-side Turnstile verifier. Fails CLOSED: any error/non-success
 *  → false (never let an unverifiable submission through). `fetchImpl` is
 *  injectable for tests. */
export function createTurnstileVerifier(secret: string, fetchImpl: typeof fetch = fetch): TurnstileVerifier {
  return async (token, remoteip) => {
    try {
      const body = new URLSearchParams({ secret, response: token })
      if (remoteip) body.set('remoteip', remoteip)
      const res = await fetchImpl(SITEVERIFY, { method: 'POST', body })
      if (!res.ok) return false
      const data = (await res.json()) as { success?: boolean }
      return data.success === true
    } catch {
      return false
    }
  }
}
