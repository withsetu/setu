/** The ONE case/normalization fold every SubmissionPort adapter applies to both
 *  the search term and each field value before a substring match (#1166). NFC
 *  first so a decomposed "É" and a composed "É" compare equal, then the
 *  full-Unicode `toLowerCase` (SQLite's built-in `lower()` folds ASCII only).
 *  db-sqlite registers this as a SQL function so it can run inside the query.
 *  Agreement across adapters is enforced by the non-ASCII case in
 *  packages/db-testing/src/index.ts (runSubmissionPortContract). */
export function foldForSearch(s: string): string {
  return s.normalize('NFC').toLowerCase()
}
