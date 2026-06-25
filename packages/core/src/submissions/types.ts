/** A stored form submission. Runtime data — DB only, never Git. */
export interface Submission {
  id: string
  /** Stable id of the form that produced this (the block's `formId` prop). */
  formId: string
  /** Human label for the inbox; falls back to formId when absent. */
  formLabel?: string
  /** Submitted field values (name/email/subject/message). */
  fields: Record<string, string>
  /** Epoch ms, assigned by the adapter. */
  createdAt: number
  /** Triage flag for the inbox. */
  read: boolean
  /** Best-effort request provenance. */
  source?: { url?: string; referrer?: string; userAgent?: string }
}

/** Input to saveSubmission; the adapter assigns id/createdAt and defaults read=false. */
export interface SubmissionInput {
  formId: string
  formLabel?: string
  fields: Record<string, string>
  source?: { url?: string; referrer?: string; userAgent?: string }
}

/** Listing filter. `q` is a basic case-insensitive substring match over field values. */
export interface SubmissionFilter {
  formId?: string
  read?: boolean
  q?: string
  limit?: number
  offset?: number
}

/** Inbox form-filter row. */
export interface FormSummary {
  formId: string
  formLabel?: string
  count: number
}
