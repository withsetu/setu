import type { SubmissionPort, Submission, SubmissionInput } from '@setu/core'
import { selectDistinctForms } from '@setu/core'

/** In-memory SubmissionPort (Map-backed, browser-safe). Value semantics via
 *  structuredClone so callers cannot mutate stored rows. Mirrors db-memory's
 *  DataPort adapter. */
export function createMemorySubmissionPort(seed: SubmissionInput[] = []): SubmissionPort {
  const rows = new Map<string, Submission>()

  const put = (input: SubmissionInput): Submission => {
    const stored: Submission = structuredClone({
      id: crypto.randomUUID(),
      formId: input.formId,
      formLabel: input.formLabel,
      fields: input.fields,
      source: input.source,
      createdAt: Date.now(),
      read: false,
    })
    rows.set(stored.id, stored)
    return structuredClone(stored)
  }

  for (const s of seed) put(s)

  const matchesQ = (s: Submission, q: string) =>
    Object.values(s.fields).some((v) => v.toLowerCase().includes(q.toLowerCase()))

  return {
    async saveSubmission(input) {
      return put(input)
    },
    async getSubmission(id) {
      const r = rows.get(id)
      return r ? structuredClone(r) : null
    },
    async listSubmissions(filter) {
      let all = [...rows.values()]
      if (filter?.formId !== undefined) all = all.filter((r) => r.formId === filter.formId)
      if (filter?.read !== undefined) all = all.filter((r) => r.read === filter.read)
      if (filter?.q) all = all.filter((r) => matchesQ(r, filter.q!))
      all.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      const total = all.length
      const offset = filter?.offset ?? 0
      const limit = filter?.limit ?? all.length
      return { rows: all.slice(offset, offset + limit).map((r) => structuredClone(r)), total }
    },
    async setRead(ids, read) {
      for (const id of ids) {
        const r = rows.get(id)
        if (r) r.read = read
      }
    },
    async deleteSubmissions(ids) {
      for (const id of ids) rows.delete(id)
    },
    async distinctForms() {
      return selectDistinctForms([...rows.values()])
    },
    async close() {},
  }
}
