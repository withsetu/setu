import type { SubmissionPort } from './submission-port'
import type { Submission, SubmissionFilter } from './types'

/** Largest page the `GET /forms/submissions` boundary accepts (#1166), chosen to
 *  match the index API's MAX_LIMIT. The inbox pages at 20; CSV export walks pages of
 *  this size via `listAllSubmissions`. */
export const SUBMISSIONS_PAGE_MAX = 100
/** Page size the boundary applies when the caller sends no `limit`. */
export const SUBMISSIONS_PAGE_DEFAULT = 50

/** Defensive clamp for a storage adapter's paging inputs (#1166). The API
 *  boundary already rejects malformed values; this keeps a direct port caller
 *  from widening a result:
 *  - offset: finite → floored, min 0; anything else → 0.
 *  - limit: absent or +Infinity → undefined ("no limit", the documented default);
 *    finite → floored, min 0; NaN or -Infinity → 0 (never "every row").
 *  Enforced by runSubmissionPortPagingClampContract in
 *  packages/db-testing/src/index.ts. */
export function normalizeSubmissionPage(
  filter: Pick<SubmissionFilter, 'limit' | 'offset'> | undefined
): { offset: number; limit: number | undefined } {
  const rawOffset = filter?.offset
  const offset =
    rawOffset !== undefined && Number.isFinite(rawOffset)
      ? Math.max(0, Math.floor(rawOffset))
      : 0
  const rawLimit = filter?.limit
  let limit: number | undefined
  if (rawLimit === undefined || rawLimit === Number.POSITIVE_INFINITY)
    limit = undefined
  else if (Number.isFinite(rawLimit)) limit = Math.max(0, Math.floor(rawLimit))
  else limit = 0
  return { offset, limit }
}

/** Read EVERY row matching `filter` by walking pages of `pageSize` — for callers
 *  (CSV export) that need the full set through a page-capped port such as the
 *  HTTP adapter. Rows are de-duplicated by id: a submission arriving mid-walk
 *  shifts the newest-first list down by one, which would otherwise repeat a row at
 *  a page boundary. (A deletion mid-walk can still shift one row past the walk;
 *  export is a point-in-time convenience, not a snapshot.) Stops on a short or
 *  empty page, so it terminates even if `total` changes underneath it.
 *  Pinned by packages/core/test/submissions/paging.test.ts. */
export async function listAllSubmissions(
  port: Pick<SubmissionPort, 'listSubmissions'>,
  filter: Omit<SubmissionFilter, 'limit' | 'offset'> = {},
  pageSize: number = SUBMISSIONS_PAGE_MAX
): Promise<Submission[]> {
  const size = Math.max(1, Math.floor(pageSize))
  const seen = new Set<string>()
  const out: Submission[] = []
  for (let offset = 0; ; offset += size) {
    const { rows } = await port.listSubmissions({
      ...filter,
      limit: size,
      offset
    })
    for (const r of rows)
      if (!seen.has(r.id)) {
        seen.add(r.id)
        out.push(r)
      }
    if (rows.length < size) return out
  }
}
