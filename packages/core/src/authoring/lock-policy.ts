import type { Lock } from '../data/types'
import type { LockDecision } from './types'

/** Decide what to do with an entry's lock for `editor` at time `now`. Pure (no
 *  IO). Staleness uses a strict `>` so `now - lockedAt === ttlMs` is still fresh. */
export function evaluateLock(
  lock: Lock | null,
  editor: string,
  now: number,
  ttlMs: number,
): LockDecision {
  if (lock === null) return 'acquire'
  if (lock.lockedBy === editor) return 'refresh'
  if (now - lock.lockedAt > ttlMs) return 'takeover'
  return 'blocked'
}
