/** Structured audit-event seam (#248 Task 9). v1 consumer is a `console.info` line in server.ts;
 *  the real consumer — persistence/alerting — is future issue #290. Emission points are documented
 *  per-event-type in index.ts (databaseHooks), local-token-plugin.ts, and server-setup-plugin.ts
 *  (direct emission), and apps/api/src/server.ts (the sign-in-failure wrapper — see its own
 *  comment for why that one event can't be hooked from better-auth internals).
 *
 *  `meta` is free-form string key/value pairs for non-sensitive context (e.g. a role name, a ban
 *  reason). It must NEVER carry a secret, password, or token — every emission site is responsible
 *  for only putting safe, already-non-secret values in `meta`; there is no runtime redaction here
 *  (redacting after the fact can't undo a secret already having been placed in a value passed
 *  around/logged) — correctness is enforced by review + the test suite asserting no known
 *  token/password fixture value ever appears in a serialized event. */
export type AuthEventType =
  | 'login.success'
  | 'login.failure'
  | 'logout'
  | 'user.created'
  | 'role.changed'
  | 'user.banned'
  | 'user.unbanned'
  | 'user.deleted'
  | 'setup.completed'
  | 'local.exchange'

export interface AuthEvent {
  type: AuthEventType
  /** The user id performing the action, when known/applicable (e.g. the admin calling setRole). */
  actorId?: string
  /** The user id the event is about/targets, when applicable (e.g. the user being banned). */
  targetId?: string
  /** Free-form non-secret context. NEVER a token/password — see the module comment. */
  meta?: Record<string, string>
}
