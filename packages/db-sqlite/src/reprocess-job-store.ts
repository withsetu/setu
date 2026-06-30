import Database from 'better-sqlite3'
import type { ReprocessJob, ReprocessJobStore, ReprocessStatus } from '@setu/core'

interface Row {
  id: string; total: number; processed: number; cursor: number
  status: ReprocessStatus; error: string | null; keys: string; startedAt: number; updatedAt: number
}
const toJob = (r: Row): ReprocessJob => ({
  id: r.id, total: r.total, processed: r.processed, cursor: r.cursor,
  status: r.status, ...(r.error ? { error: r.error } : {}),
  keys: JSON.parse(r.keys) as string[], startedAt: r.startedAt, updatedAt: r.updatedAt,
})

export function createSqliteReprocessJobStore(file: string): ReprocessJobStore {
  const db = new Database(file)
  db.exec(`CREATE TABLE IF NOT EXISTS reprocess_jobs (
    id TEXT PRIMARY KEY, total INTEGER NOT NULL, processed INTEGER NOT NULL,
    cursor INTEGER NOT NULL, status TEXT NOT NULL, error TEXT,
    keys TEXT NOT NULL, startedAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`)
  const getRow = db.prepare('SELECT * FROM reprocess_jobs WHERE id = ?')
  return {
    create(keys, now) {
      const id = crypto.randomUUID()
      const job: ReprocessJob = { id, total: keys.length, processed: 0, cursor: 0, status: 'running', keys, startedAt: now, updatedAt: now }
      db.prepare(`INSERT INTO reprocess_jobs (id,total,processed,cursor,status,error,keys,startedAt,updatedAt)
        VALUES (@id,@total,@processed,@cursor,@status,NULL,@keys,@startedAt,@updatedAt)`)
        .run({ ...job, keys: JSON.stringify(keys) })
      return job
    },
    get(id) { const r = getRow.get(id) as Row | undefined; return r ? toJob(r) : null },
    active() { const r = db.prepare("SELECT * FROM reprocess_jobs WHERE status = 'running' ORDER BY startedAt DESC").get() as Row | undefined; return r ? toJob(r) : null },
    latest() { const r = db.prepare('SELECT * FROM reprocess_jobs ORDER BY startedAt DESC').get() as Row | undefined; return r ? toJob(r) : null },
    saveProgress(id, processed, cursor, now) { db.prepare('UPDATE reprocess_jobs SET processed=?, cursor=?, updatedAt=? WHERE id=?').run(processed, cursor, now, id) },
    finish(id, status, now, error) { db.prepare('UPDATE reprocess_jobs SET status=?, error=?, updatedAt=? WHERE id=?').run(status, error ?? null, now, id) },
  }
}
