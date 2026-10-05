/** A failed site build's job error, with a named, operator-actionable reason prepended when the
 *  build's log tail carries one this module recognises (#1183). `message` is the runner's own
 *  error ("build exited with code 1", a timeout, a spawn error) and is kept verbatim after the
 *  reason, so nothing the job used to say is lost. An unrecognised tail returns `message`
 *  unchanged: this names causes it is sure of, never a guess.
 *
 *  The job error reaches the admin's Publish toast and "Last build failed" line, so a reason
 *  names the variable and the fix but no path and no configured value.
 *
 *  Recognised today: the site's #1118 refusal to build without a valid SETU_SITE_URL
 *  (`apps/site/integrations/require-site-url.mjs`). Matched against that module's real output in
 *  apps/api/test/build-failure.test.ts, so a reworded refusal fails there. */
export function explainBuildFailure(
  message: string,
  logTail: string | undefined
): string {
  if (logTail === undefined) return message
  const reason = knownReason(stripAnsi(logTail))
  return reason === null ? message : `${reason} (${message})`
}

const SITE_URL_FIX =
  "Set it in the API server's environment to the public origin the site is served from " +
  '(for example https://www.example.com), restart the API, and publish again.'

function knownReason(tail: string): string | null {
  if (tail.includes('SETU_SITE_URL is not set.'))
    return `SETU_SITE_URL is not set, and the site build needs it. ${SITE_URL_FIX}`
  if (tail.includes('SETU_SITE_URL must be an absolute http(s) URL'))
    return `SETU_SITE_URL is not an absolute http(s) URL, so the site build refused it. ${SITE_URL_FIX}`
  return null
}

/** SGR colour sequences (`ESC [ … m`) — build tools colour their errors when they think they
 *  have a terminal, which would split the phrases matched above. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '')
}
