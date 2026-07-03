/** The single credentials choke point for admin -> API fetches (#248 Task 6).
 *
 *  The admin (localhost:5173) and the api (localhost:4444) are different origins in dev, and
 *  different origins in most self-hosted topologies too — so every request that should carry the
 *  Better Auth session cookie MUST set `credentials: 'include'` (the default, 'same-origin',
 *  silently drops the cookie cross-origin). Rather than scatter that fetch option across every
 *  call site (git-http, submission-http, media-client, upload-client, useCapabilities, settings
 *  screens, the editor's preview post), everything that talks to the API imports this one
 *  `apiFetch` and threads it in as the adapter's injectable `fetch`/`fetchImpl`, or calls it
 *  directly where there's no adapter factory in between.
 *
 *  `credentials: 'include'` always wins — even if a caller's init tries to override it — because
 *  there is no legitimate reason for an admin->API call to want to drop the ambient session; a
 *  caller passing `credentials: 'omit'` is far more likely a copy-paste mistake than intent.
 *
 *  better-auth's own React client manages its own cookie/session handling independently (it isn't
 *  routed through this helper) — see auth-client.ts.
 */
export const apiFetch: typeof fetch = (input, init) => fetch(input, { ...init, credentials: 'include' })
