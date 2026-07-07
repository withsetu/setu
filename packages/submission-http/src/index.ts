import type {
  SubmissionPort,
  Submission,
  SubmissionInput,
  SubmissionFilter,
  FormSummary
} from '@setu/core'

/** A SubmissionPort backed by createFormsApi over HTTP. Mirrors git-http: the
 *  browser admin uses this to read/manage submissions stored by apps/api. */
export function createHttpSubmissionAdapter(opts: {
  baseUrl: string
  fetchImpl?: typeof fetch
}): SubmissionPort {
  const base = opts.baseUrl.replace(/\/$/, '')
  const f = opts.fetchImpl ?? fetch
  const json = async (res: Response) => {
    if (!res.ok) throw new Error(`forms api ${res.status}`)
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
