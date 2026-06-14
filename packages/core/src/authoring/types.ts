import type { Draft, DraftInput, EntryRef, Lock } from '../data/types'
import type { DataPort } from '../data/data-port'

/** Default pessimistic-lock TTL: 10 minutes (PRD §9 says ~5-10 min). */
export const DEFAULT_LOCK_TTL_MS = 600_000

/** Pure decision derived from the current lock state. */
export type LockDecision = 'acquire' | 'refresh' | 'takeover' | 'blocked'

/** Outcome reported to callers (granted decisions + the blocked case). */
export type LockOutcome = 'acquired' | 'refreshed' | 'tookOver' | 'blocked'

export interface OpenResult {
  /** True unless blocked by another editor's fresh lock. */
  granted: boolean
  outcome: LockOutcome
  /** The caller's lock when granted; the holder's lock when blocked. */
  lock: Lock
  /** Current draft (null if none); returned even when blocked (read-only view). */
  draft: Draft | null
}

export interface SaveResult {
  /** True if persisted; false if blocked (nothing was written). */
  saved: boolean
  outcome: LockOutcome
  /** The caller's lock when saved; the holder's lock when blocked. */
  lock: Lock
  /** The saved draft when saved; the current (unchanged) draft when blocked. */
  draft: Draft | null
}

export interface LockStatus {
  lock: Lock
  /** now - lockedAt > ttl. */
  stale: boolean
}

export interface AuthoringService {
  open(ref: EntryRef, editor: string): Promise<OpenResult>
  save(input: DraftInput, editor: string): Promise<SaveResult>
  release(ref: EntryRef, editor: string): Promise<{ released: boolean }>
  forceUnlock(ref: EntryRef): Promise<void>
  status(ref: EntryRef): Promise<LockStatus | null>
}

export interface AuthoringDeps {
  data: DataPort
  /** Defaults to () => Date.now(). */
  now?: () => number
  /** Defaults to DEFAULT_LOCK_TTL_MS. */
  lockTtlMs?: number
}
