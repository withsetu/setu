/** #918: the ONE in-process sliding-window limiter in this app.
 *
 *  #885 grew the first copy inline in `apps/api/src/email.ts` (3 test-sends per actor per
 *  minute). #918 needed two more bounds on the anonymous `POST /forms/submit` path, so the
 *  Map-of-timestamps is extracted here rather than forked twice more; email.ts now consumes it
 *  and its behaviour is unchanged (parity pinned by apps/api/test/rate-limit.test.ts, "the
 *  test-send limiter it replaced", alongside the untouched apps/api/test/email-api.test.ts).
 *
 *  In-process on purpose, and this is the honest limit of it: a multi-process or multi-instance
 *  deployment gets one bucket set PER process, so the effective bound is `max × instances`. It is
 *  a per-instance ceiling, not a distributed-abuse defence — a shared store is the upgrade path,
 *  not something this module pretends to be.
 */

/** A sliding-window counter keyed by an arbitrary string. `check` is a pure question (it
 *  consumes nothing), `record` consumes one slot — the split exists because a route may decide,
 *  after checking, that no work will happen and no quota should be burned (email.ts's 409
 *  no-from-address branch). */
export interface WindowLimiter {
  /** True while `key` has quota left in the current window. Consumes nothing. */
  check(key: string): boolean
  /** Consume one slot for `key`. */
  record(key: string): void
  /** Live key count — observability for the eviction behaviour
   *  (apps/api/test/rate-limit.test.ts, "bounds its own memory"). */
  readonly size: number
  readonly max: number
  readonly windowMs: number
}

export interface WindowLimiterOptions {
  max: number
  windowMs: number
  /** Injectable clock for tests. */
  now?: () => number
  /** Cap on the number of live keys. REQUIRED for any limiter keyed on something the caller
   *  controls (a client IP): without it the Map is itself the DoS — one request per forged
   *  source address grows it forever. Eviction is least-recently-recorded first and can only
   *  ever FORGET a bucket, never grant a surviving key extra quota, so an attacker who cycles
   *  addresses can flush other buckets but still gets only `max` per address they use; the
   *  notification ceiling (createNotifyCeiling) is the bound that does not depend on key
   *  cardinality at all. Omit for keys drawn from a bounded server-side set (actor ids). */
  maxKeys?: number
}

export function createWindowLimiter(opts: WindowLimiterOptions): WindowLimiter {
  const now = opts.now ?? Date.now
  const { max, windowMs, maxKeys } = opts
  // key → the send timestamps still inside the window. Re-inserted on every `record` so the
  // Map's own insertion order doubles as least-recently-recorded order for eviction.
  const recent = new Map<string, number[]>()

  const prune = (key: string, t: number): number[] => {
    const stamps = (recent.get(key) ?? []).filter((s) => t - s < windowMs)
    if (stamps.length === 0) recent.delete(key)
    else recent.set(key, stamps)
    return stamps
  }

  const evict = (): void => {
    if (maxKeys === undefined) return
    while (recent.size > maxKeys) {
      const oldest = recent.keys().next()
      if (oldest.done === true) return
      recent.delete(oldest.value)
    }
  }

  return {
    check(key) {
      return prune(key, now()).length < max
    },
    record(key) {
      const t = now()
      const stamps = prune(key, t)
      stamps.push(t)
      // delete-then-set moves the key to the end of the iteration order: Map.set on an existing
      // key keeps its ORIGINAL position, which would make `evict` drop by first-seen instead of
      // least-recently-recorded.
      recent.delete(key)
      recent.set(key, stamps)
      evict()
    },
    get size() {
      return recent.size
    },
    max,
    windowMs
  }
}

/** #918 layer 1 — the hard guarantee.
 *
 *  A ceiling on form NOTIFICATIONS SENT per window, for the whole process, keyed on nothing.
 *  That is the entire point: every other bound in this file depends on identifying the caller,
 *  and an unauthenticated caller can vary anything that identifies them. This one cannot be
 *  bypassed by varying an address, a header or a session, because none of them feed it — the
 *  property is pinned by apps/api/test/rate-limit.test.ts ("does not depend on any caller
 *  identity") and, end-to-end through the submit pipeline, by
 *  packages/core/test/submissions/submission-service.test.ts ("the notification ceiling").
 *
 *  It bounds outbound mail — the operator's sending reputation, quota and bill — NOT submissions:
 *  the caller (core's submission service) has already persisted the row when it consults this, so
 *  hitting the ceiling loses an email, never a genuine submission.
 *
 *  Returns null to allow (consuming a slot) or a named operator-facing reason to skip. The reason
 *  is written for the api log via `onNotifySkipped`, so it names the remediation env vars and
 *  never echoes a recipient address. */
export function createNotifyCeiling(opts: {
  max: number
  windowMs: number
  now?: () => number
}): () => string | null {
  const limiter = createWindowLimiter({
    max: opts.max,
    windowMs: opts.windowMs,
    ...(opts.now ? { now: opts.now } : {})
  })
  const KEY = 'form-notifications'
  const window =
    opts.windowMs % 60_000 === 0
      ? `${opts.windowMs / 60_000} minute(s)`
      : `${Math.round(opts.windowMs / 1000)} second(s)`
  return () => {
    if (!limiter.check(KEY)) {
      return (
        `the outbound notification ceiling is in force (at most ${opts.max} form ` +
        `notifications per ${window} from this server) — the submission was saved, only its ` +
        `email was skipped. Raise SETU_FORMS_NOTIFY_MAX_PER_WINDOW / ` +
        `SETU_FORMS_NOTIFY_WINDOW_MS if this is legitimate volume.`
      )
    }
    limiter.record(KEY)
    return null
  }
}

/** Operator overrides for a bound, read from the environment. Fails closed in the only direction
 *  that matters here: an override this cannot parse falls back to the DEFAULT, never to
 *  "unlimited", and the reason comes back in `problems` for server.ts to log (an override that
 *  silently did nothing would be worse than one that was rejected loudly).
 *  Pinned by apps/api/test/rate-limit.test.ts ("boundFromEnv"). */
export function boundFromEnv(opts: {
  raw: { max?: string | undefined; windowMs?: string | undefined }
  defaults: { max: number; windowMs: number }
  names: { max: string; windowMs: string }
}): { max: number; windowMs: number; problems: string[] } {
  const problems: string[] = []
  const read = (
    raw: string | undefined,
    fallback: number,
    name: string
  ): number => {
    if (raw === undefined || raw.trim() === '') return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) {
      problems.push(
        `${name} must be a positive integer (got ${JSON.stringify(raw)}) — using the default ${fallback}`
      )
      return fallback
    }
    return n
  }
  return {
    max: read(opts.raw.max, opts.defaults.max, opts.names.max),
    windowMs: read(
      opts.raw.windowMs,
      opts.defaults.windowMs,
      opts.names.windowMs
    ),
    problems
  }
}
