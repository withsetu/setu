import type {
  SubmissionPort,
  Submission,
  SubmissionInput,
  SubmissionFilter,
  FormSummary
} from '@setu/core'

/** A non-2xx answer from the forms API, carrying BOTH the status and the
 *  machine-readable reason the API sent (`{ error: 'forbidden' | 'invalid' |
 *  'too_large' }` — apps/api/src/forms.ts). Before #899 every failure collapsed
 *  into `Error('forms api <status>')`, so a 403 and a 400 were indistinguishable
 *  at the call site; same shape as #870's `MediaTransportError`.
 *  Covered by packages/submission-http/test/errors.test.ts. */
export class SubmissionApiError extends Error {
  readonly status: number
  /** The API's `error` code, or `undefined` when the body carried none (or was
   *  not JSON at all — a proxy's HTML 502, say). */
  readonly code: string | undefined

  constructor(status: number, code?: string) {
    super(code ? `forms api ${status}: ${code}` : `forms api ${status}`)
    this.name = 'SubmissionApiError'
    this.status = status
    this.code = code
  }
}

/** A SubmissionPort backed by createFormsApi over HTTP. Mirrors git-http: the
 *  browser admin uses this to read/manage submissions stored by apps/api.
 *
 *  `fetchImpl` is REQUIRED, not defaulted to bare `fetch` (#899): the browser
 *  admin must pass `apiFetch`, since a bare `fetch` drops the cross-origin session
 *  cookie and every call would 401. Making the choice explicit keeps a future
 *  caller from inheriting that silently. */
export function createHttpSubmissionAdapter(opts: {
  baseUrl: string
  fetchImpl: typeof fetch
}): SubmissionPort {
  const base = opts.baseUrl.replace(/\/$/, '')
  const f = opts.fetchImpl
  const json = async (res: Response) => {
    if (!res.ok) {
      // Narrowed rather than cast (#914). The old `as { error?: string }` trusted the
      // remote body twice over: a JSON `null` body made `detail.error` throw a TypeError
      // that replaced the real failure, and any non-string `error` landed in
      // `SubmissionApiError.code` while the type said `string | undefined`.
      // packages/submission-http/test/errors.test.ts covers both.
      const detail: unknown = await res.json().catch(() => null)
      const raw =
        typeof detail === 'object' && detail !== null
          ? (detail as { error?: unknown }).error
          : undefined
      throw new SubmissionApiError(
        res.status,
        typeof raw === 'string' ? raw : undefined
      )
    }
    return res.json()
  }

  return {
    async saveSubmission(input: SubmissionInput) {
      return (await json(
        await f(`${base}/forms/submissions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input)
        })
      )) as Submission
    },
    async getSubmission(id) {
      const res = await f(`${base}/forms/submissions/${encodeURIComponent(id)}`)
      if (res.status === 404) return null
      return (await json(res)) as Submission
    },
    async listSubmissions(filter?: SubmissionFilter) {
      const p = new URLSearchParams()
      if (filter?.formId !== undefined) p.set('formId', filter.formId)
      if (filter?.read !== undefined) p.set('read', String(filter.read))
      if (filter?.q) p.set('q', filter.q)
      if (filter?.limit !== undefined) p.set('limit', String(filter.limit))
      if (filter?.offset !== undefined) p.set('offset', String(filter.offset))
      const qs = p.toString()
      return (await json(
        await f(`${base}/forms/submissions${qs ? `?${qs}` : ''}`)
      )) as {
        rows: Submission[]
        total: number
      }
    },
    async setRead(ids, read) {
      await json(
        await f(`${base}/forms/submissions/read`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids, read })
        })
      )
    },
    async deleteSubmissions(ids) {
      await json(
        await f(`${base}/forms/submissions`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids })
        })
      )
    },
    async distinctForms() {
      return (
        (await json(await f(`${base}/forms/forms`))) as { forms: FormSummary[] }
      ).forms
    },
    async close() {}
  }
}
