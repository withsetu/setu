export type ReprocessStatus = 'running' | 'done' | 'failed'

export interface ReprocessJob {
  id: string
  total: number
  processed: number
  cursor: number // next index into keys[] to process
  status: ReprocessStatus
  error?: string
  keys: string[] // snapshot of manifest keys at job start
  startedAt: number
  updatedAt: number
}

export interface ReprocessJobStore {
  create(keys: string[], now: number): ReprocessJob // status 'running', cursor/processed 0
  get(id: string): ReprocessJob | null
  active(): ReprocessJob | null // the single 'running' job, if any
  latest(): ReprocessJob | null // most-recent job by startedAt (for status)
  saveProgress(id: string, processed: number, cursor: number, now: number): void
  finish(
    id: string,
    status: 'done' | 'failed',
    now: number,
    error?: string
  ): void
}
