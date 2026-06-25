import type { Submission, FormSummary } from './types'

/** Group submissions by formId with counts; the most-recent submission's label
 *  wins; sorted by formId. The single impl shared by every SubmissionPort adapter. */
export function selectDistinctForms(rows: Submission[]): FormSummary[] {
  const byId = new Map<string, { label?: string; labelAt: number; count: number }>()
  for (const r of rows) {
    const cur = byId.get(r.formId)
    if (!cur) {
      byId.set(r.formId, { label: r.formLabel, labelAt: r.createdAt, count: 1 })
    } else {
      cur.count++
      if (r.createdAt >= cur.labelAt) {
        cur.label = r.formLabel
        cur.labelAt = r.createdAt
      }
    }
  }
  return [...byId.entries()]
    .map(([formId, v]) => ({ formId, formLabel: v.label, count: v.count }))
    .sort((a, b) => a.formId.localeCompare(b.formId))
}
