import type { AttestationRecord, HealthState } from './types'

/** Repo-root file the Git-backed health attestations persist to. Shared by the admin writer
 *  (apps/admin/src/health/health-state.ts) and the API's writable-path allowlist (#1154). */
export const HEALTH_STATE_PATH = 'site-health.json'

const isRecord = (v: unknown): v is AttestationRecord =>
  typeof v === 'object' &&
  v !== null &&
  ((v as { state?: unknown }).state === 'attested' ||
    (v as { state?: unknown }).state === 'na')

function parseBucket(raw: unknown): Record<string, AttestationRecord> {
  const out: Record<string, AttestationRecord> = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isRecord(v))
      out[k] = {
        state: v.state,
        at: typeof v.at === 'string' ? v.at : '',
        by: typeof v.by === 'string' ? v.by : ''
      }
  }
  return out
}

/** Parse the Git-backed health state. Never throws; malformed → empty. */
export function parseHealthState(raw: unknown): HealthState {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    items?: unknown
    sections?: unknown
  }
  return { items: parseBucket(obj.items), sections: parseBucket(obj.sections) }
}

/** Immutably set (or clear, when record is null) one item/section record. */
export function setHealthRecord(
  state: HealthState,
  kind: 'item' | 'section',
  id: string,
  record: AttestationRecord | null
): HealthState {
  const bucketKey = kind === 'item' ? 'items' : 'sections'
  const bucket = { ...state[bucketKey] }
  if (record === null) delete bucket[id]
  else bucket[id] = record
  return { ...state, [bucketKey]: bucket }
}
