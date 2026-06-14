import type { EntryRef } from '../data/types'
import type {
  AuthoringDeps,
  AuthoringService,
  LockDecision,
  LockOutcome,
} from './types'
import { DEFAULT_LOCK_TTL_MS } from './types'
import { evaluateLock } from './lock-policy'

const outcomeFor = (decision: Exclude<LockDecision, 'blocked'>): LockOutcome =>
  decision === 'acquire' ? 'acquired' : decision === 'refresh' ? 'refreshed' : 'tookOver'

/** Draft + pessimistic-lock orchestration over a DataPort (PRD §9). */
export function createAuthoringService(deps: AuthoringDeps): AuthoringService {
  const { data } = deps
  const now = deps.now ?? (() => Date.now())
  const ttl = deps.lockTtlMs ?? DEFAULT_LOCK_TTL_MS

  return {
    async open(ref, editor) {
      const t = now()
      const existing = await data.getLock(ref)
      const decision = evaluateLock(existing, editor, t, ttl)
      const draft = await data.getDraft(ref)
      if (decision === 'blocked') {
        // 'blocked' is only returned when a lock exists (held by another, fresh).
        return { granted: false, outcome: 'blocked', lock: existing!, draft }
      }
      const lock = { ...ref, lockedBy: editor, lockedAt: t }
      await data.putLock(lock)
      return { granted: true, outcome: outcomeFor(decision), lock, draft }
    },

    async save(input, editor) {
      const t = now()
      const ref: EntryRef = {
        collection: input.collection,
        locale: input.locale,
        slug: input.slug,
      }
      const existing = await data.getLock(ref)
      const decision = evaluateLock(existing, editor, t, ttl)
      if (decision === 'blocked') {
        return { saved: false, outcome: 'blocked', lock: existing!, draft: await data.getDraft(ref) }
      }
      const lock = { ...ref, lockedBy: editor, lockedAt: t }
      await data.putLock(lock)
      const draft = await data.saveDraft(input)
      return { saved: true, outcome: outcomeFor(decision), lock, draft }
    },

    async release(ref, editor) {
      const existing = await data.getLock(ref)
      if (existing && existing.lockedBy === editor) {
        await data.deleteLock(ref)
        return { released: true }
      }
      return { released: false }
    },

    async forceUnlock(ref) {
      await data.deleteLock(ref)
    },

    async status(ref) {
      const lock = await data.getLock(ref)
      if (lock === null) return null
      return { lock, stale: now() - lock.lockedAt > ttl }
    },
  }
}
