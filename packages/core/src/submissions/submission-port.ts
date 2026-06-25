import type { Submission, SubmissionFilter, SubmissionInput, FormSummary } from './types'

/** Storage for form submissions. The DB is the source of truth for submissions
 *  (runtime data, never Git). Mirrors the DataPort grain. */
export interface SubmissionPort {
  /** Insert; assigns id + createdAt, read=false. Returns the stored row. */
  saveSubmission(input: SubmissionInput): Promise<Submission>
  getSubmission(id: string): Promise<Submission | null>
  /** Newest-first; returns the filtered page plus the unpaged total. */
  listSubmissions(filter?: SubmissionFilter): Promise<{ rows: Submission[]; total: number }>
  /** Idempotent bulk read/unread; ignores ids that do not exist. */
  setRead(ids: string[], read: boolean): Promise<void>
  /** Bulk delete; ignores ids that do not exist. */
  deleteSubmissions(ids: string[]): Promise<void>
  /** Distinct forms with counts, for the inbox filter. */
  distinctForms(): Promise<FormSummary[]>
  close(): Promise<void>
}
