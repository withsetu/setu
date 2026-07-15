import Database from 'better-sqlite3'
import type {
  DeployJob,
  DeployJobStore,
  DeployJobStatus,
  DeployMode
} from '@setu/core'

interface Row {
  id: string
  status: DeployJobStatus
  mode: DeployMode
  sha: string
  error: string | null
  logTail: string | null
  startedAt: number
  updatedAt: number
}

const toJob = (r: Row): DeployJob => ({
  id: r.id,
  status: r.status,
  mode: r.mode,
  sha: r.sha,
  ...(r.error ? { error: r.error } : {}),
  ...(r.logTail ? { logTail: r.logTail } : {}),
  startedAt: r.startedAt,
  updatedAt: r.updatedAt
})

export function createSqliteDeployJobStore(file: string): DeployJobStore {
  const db = new Database(file)
  db.exec(`CREATE TABLE IF NOT EXISTS deploy_jobs (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, mode TEXT NOT NULL,
    sha TEXT NOT NULL, error TEXT, logTail TEXT,
    startedAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`)
  const getRow = db.prepare('SELECT * FROM deploy_jobs WHERE id = ?')
  return {
    create(sha, mode, now) {
      const job: DeployJob = {
        id: crypto.randomUUID(),
        status: 'running',
        mode,
        sha,
        startedAt: now,
        updatedAt: now
      }
      db.prepare(
        `INSERT INTO deploy_jobs (id,status,mode,sha,error,logTail,startedAt,updatedAt)
        VALUES (@id,@status,@mode,@sha,NULL,NULL,@startedAt,@updatedAt)`
      ).run(job)
      return job
    },
    get(id) {
      const r = getRow.get(id) as Row | undefined
      return r ? toJob(r) : null
    },
    active() {
      const r = db
        .prepare(
          "SELECT * FROM deploy_jobs WHERE status = 'running' ORDER BY startedAt DESC"
        )
        .get() as Row | undefined
      return r ? toJob(r) : null
    },
    latest() {
      const r = db
        .prepare('SELECT * FROM deploy_jobs ORDER BY startedAt DESC')
        .get() as Row | undefined
      return r ? toJob(r) : null
    },
    finish(id, status, now, opts) {
      db.prepare(
        'UPDATE deploy_jobs SET status=?, error=?, logTail=?, updatedAt=? WHERE id=?'
      ).run(status, opts?.error ?? null, opts?.logTail ?? null, now, id)
    }
  }
}
