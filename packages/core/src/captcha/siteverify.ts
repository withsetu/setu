/** How long a captcha adapter waits on a provider's siteverify before failing closed. Matches the
 *  bound better-auth's own captcha plugin puts on the same call (`CAPTCHA_VERIFY_TIMEOUT_MS` in
 *  better-auth 1.7.3 dist/plugins/captcha/constants.mjs), so the forms path and the sign-in path
 *  give up at the same moment. */
export const SITEVERIFY_TIMEOUT_MS = 10_000

/** POST a form-encoded siteverify request and return the parsed JSON body, or `null` on ANY
 *  failure: a thrown transport, a non-OK status, an unparseable body, or the deadline passing.
 *  Callers treat `null` as "not verified" — fail closed.
 *
 *  The deadline races the WHOLE exchange (headers and body) rather than trusting `fetch` to honour
 *  the abort signal, and also aborts the signal so a well-behaved transport releases its socket.
 *  Both halves are enforced for every adapter by the "siteverify deadline" cases of
 *  `runCaptchaPortContract` (packages/captcha-testing/src/index.ts), which use a transport that
 *  never settles and ignores its signal. */
export async function postSiteverify(opts: {
  fetchImpl: typeof fetch
  url: string
  body: URLSearchParams
  timeoutMs?: number
}): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, opts.timeoutMs ?? SITEVERIFY_TIMEOUT_MS)
  })
  const exchange = (async (): Promise<unknown> => {
    const res = await opts.fetchImpl(opts.url, {
      method: 'POST',
      body: opts.body,
      signal: controller.signal
    })
    if (!res.ok) return null
    return await res.json()
  })().catch(() => null)
  try {
    return await Promise.race([exchange, deadline])
  } finally {
    clearTimeout(timer)
  }
}
