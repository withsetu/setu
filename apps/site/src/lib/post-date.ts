import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Parse a frontmatter date (string|number|Date) to a valid Date, or null. */
export function parseDate(value: unknown): Date | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(value as string | number)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Committer date (ISO) of a file's last commit, or null if git/repo is unavailable. */
function gitCommitDate(absPath: string): Date | null {
  try {
    const out = execFileSync(
      'git',
      ['-C', dirname(absPath), 'log', '-1', '--format=%cI', '--', absPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    return out ? parseDate(out) : null
  } catch {
    return null
  }
}

export interface DatableEntry {
  data?: Record<string, unknown>
  filePath?: string
}

/** A post's publish date: frontmatter `date` → git commit date → file mtime → now. */
export function resolvePostDate(entry: DatableEntry): Date {
  const fm = parseDate(entry.data?.date)
  if (fm) return fm
  if (entry.filePath) {
    const abs = resolve(entry.filePath)
    const git = gitCommitDate(abs)
    if (git) return git
    try {
      return statSync(abs).mtime
    } catch {
      /* fall through to now */
    }
  }
  return new Date()
}
