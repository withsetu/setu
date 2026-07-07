import type { Submission } from './types'

const esc = (v: string): string => {
  const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/** Serialize submissions to CSV. Fixed metadata columns + the union of field keys
 *  (sorted). Date is ISO. Excel-safe quoting. */
export function submissionsToCsv(rows: Submission[]): string {
  const fieldKeys = [
    ...new Set(rows.flatMap((r) => Object.keys(r.fields)))
  ].sort()
  const header = [
    'id',
    'date',
    'formId',
    'formLabel',
    'read',
    ...fieldKeys
  ].map(esc)
  const lines = rows.map((r) =>
    [
      r.id,
      new Date(r.createdAt).toISOString(),
      r.formId,
      r.formLabel ?? '',
      String(r.read),
      ...fieldKeys.map((k) => r.fields[k] ?? '')
    ]
      .map((v) => esc(String(v)))
      .join(',')
  )
  return [header.join(','), ...lines].join('\n')
}
