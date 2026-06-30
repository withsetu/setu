import { parseHealthState, setHealthRecord, type HealthState, type AttestationRecord, type GitPort } from '@setu/core'
import { OWNER_AUTHOR } from '../data/store'

const HEALTH_PATH = 'site-health.json'

export async function loadHealthState(git: GitPort): Promise<HealthState> {
  const raw = await git.readFile(HEALTH_PATH)
  try {
    return parseHealthState(raw ? (JSON.parse(raw) as unknown) : undefined)
  } catch {
    return parseHealthState(undefined)
  }
}

/** Merge one item/section record (null clears it) and commit site-health.json. */
export async function writeHealthRecord(git: GitPort, kind: 'item' | 'section', id: string, record: AttestationRecord | null): Promise<void> {
  const current = await loadHealthState(git)
  const next = setHealthRecord(current, kind, id, record)
  await git.commitFile({
    path: HEALTH_PATH,
    content: JSON.stringify(next, null, 2) + '\n',
    message: `chore(health): ${record ? record.state : 'clear'} ${kind} ${id}`,
    author: OWNER_AUTHOR,
  })
}
