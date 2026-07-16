import { execFileSync } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

/** Parse a frontmatter date (string|number|Date) to a valid Date, or null. */
export function parseDate(value: unknown): Date | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(value as string | number)
  return Number.isNaN(d.getTime()) ? null : d
}

// ─── Build-scoped git date sweep (#506) ─────────────────────────────────────────
// Every entry without a frontmatter `date` falls back to its last git commit date.
// One `git log -1 -- <file>` subprocess per entry — repeated by each sitemap route
// and once more per post page — put ~60k serialized spawns in a 10k-entry build
// (~28 of its 32 minutes). Instead, ONE `git log --name-status` pass over the repo
// yields every path's newest commit date up front. Prod-build only: `astro dev`
// (and vitest) keep the per-file spawn so a fresh commit shows up on the next
// request — the same dev story as permalinkMap (recompute per call).

const RS = '\x1e' // record separator between commits in the sweep output

/** Parse `git log --format=%x1e%cI --name-status --diff-merges=cc` output into
 *  repo-relative path → ISO committer date of the newest commit touching that path.
 *  Log output is newest-first, so the FIRST occurrence of a path wins — the same
 *  commit `git log -1 -- <path>` reports: `--diff-merges=cc` lists a merge's files
 *  exactly when the merge result differs from ALL parents, which mirrors the
 *  history-simplification rule that makes a pathspec walk surface a merge (clean
 *  merges list nothing and the walk follows the TREESAME parent). Rename/copy lines
 *  (`R100\told\tnew`) date both sides, exactly like the per-file call (which does
 *  not `--follow`). */
export function parseGitLogDates(out: string): Map<string, string> {
  const dates = new Map<string, string>()
  for (const chunk of out.split(RS)) {
    if (!chunk) continue
    const lines = chunk.split('\n')
    const date = lines[0]?.trim()
    if (!date) continue
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line || !line.includes('\t')) continue
      // "<status>\t<path>" or "<status>\t<old>\t<new>" — every path field gets the date.
      for (const path of line.split('\t').slice(1)) {
        if (path && !dates.has(path)) dates.set(path, date)
      }
    }
  }
  return dates
}

export interface GitDateSweep {
  /** Absolute repo toplevel, symlinks resolved (`git rev-parse --show-toplevel`). */
  root: string
  /** Repo-relative path (posix separators) → ISO committer date of its newest commit.
   *  Paths git quotes (embedded quotes/control chars) stay quoted and simply miss the
   *  map — those files take the per-file fallback. */
  dates: Map<string, string>
}

/** Sweep the repo containing `dir` in one `git log` subprocess. Null when `dir` is not
 *  inside a git work tree or git is unavailable (callers fall back per-file). */
export function gitDateSweep(dir: string): GitDateSweep | null {
  const root = gitToplevel(dir)
  if (!root) return null
  try {
    const out = execFileSync(
      'git',
      [
        '-C',
        root,
        '-c',
        'core.quotepath=false',
        'log',
        `--format=${RS}%cI`,
        '--name-status',
        '--diff-merges=cc'
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 512 * 1024 * 1024
      }
    )
    return { root, dates: parseGitLogDates(out) }
  } catch {
    return null
  }
}

/** Completed sweeps by repo root; null marks a failed sweep (never retried). */
const sweeps = new Map<string, GitDateSweep | null>()
/** Directory → repo toplevel (null: not a repo). Entries cluster in a handful of
 *  directories (`content/<collection>/<locale>/`), so this costs one `rev-parse`
 *  spawn per distinct directory, once per build. */
const toplevels = new Map<string, string | null>()

function gitToplevel(dir: string): string | null {
  let top = toplevels.get(dir)
  if (top === undefined) {
    try {
      top =
        execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim() || null
    } catch {
      top = null
    }
    toplevels.set(dir, top)
  }
  return top
}

/** Build (once) and register the sweep for the repo containing `dir`. Prod builds
 *  prime lazily on the first date lookup; tests prime explicitly. */
export function primeGitDateSweep(dir: string): void {
  const top = gitToplevel(dir)
  if (!top || sweeps.has(top)) return
  sweeps.set(top, gitDateSweep(top))
}

export function resetGitDateSweepForTests(): void {
  sweeps.clear()
  toplevels.clear()
}

/** True in a prod astro build; dev and vitest resolve per-file so edits stay fresh. */
const autoSweep = (): boolean => import.meta.env?.PROD === true

/** The file's commit date from a registered sweep; undefined = no sweep coverage →
 *  caller falls back to the per-file spawn (e.g. an uncommitted file in dev). */
function sweptGitDate(absPath: string): Date | undefined {
  if (!autoSweep() && sweeps.size === 0) return undefined // dev: never sweep
  const dir = dirname(absPath)
  if (autoSweep()) primeGitDateSweep(dir)
  const top = gitToplevel(dir)
  const sweep = top ? sweeps.get(top) : undefined
  if (!sweep) return undefined
  let real = absPath
  try {
    real = realpathSync(absPath) // match git's symlink-resolved toplevel
  } catch {
    /* keep the logical path */
  }
  const rel = relative(sweep.root, real).split(sep).join('/')
  const iso = sweep.dates.get(rel)
  return iso ? (parseDate(iso) ?? undefined) : undefined
}

/** Committer date (ISO) of a file's last commit, or null if git/repo is unavailable. */
function gitCommitDate(absPath: string): Date | null {
  const swept = sweptGitDate(absPath)
  if (swept) return swept
  try {
    const out = execFileSync(
      'git',
      ['-C', dirname(absPath), 'log', '-1', '--format=%cI', '--', absPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
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
