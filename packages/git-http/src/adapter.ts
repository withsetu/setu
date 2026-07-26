import type {
  GitPort,
  CommitInput,
  CommitFilesInput,
  CommitResult,
  DiffPathEntry
} from '@setu/core'

/** One field the server refused, from a 422 `{ error, issues }` body (apps/api's #253
 *  field gate). `path` is the repo path of the offending entry, `field` its frontmatter
 *  key ('' for a whole-entry problem). */
export interface GitFieldIssue {
  path: string
  field: string
  message: string
}

/**
 * The git API ANSWERED and refused. Distinct from a bare `Error`, which here means the
 * request never got a reply at all — offline, api down, DNS, CORS.
 *
 * Callers need that split to say something true: "check your connection" is only ever
 * accurate for the untagged case. Same shape as `SubmissionApiError` (@setu/submission-http)
 * and `MediaTransportError`; mapped to user-facing copy by `writeError` in
 * apps/admin/src/ui/error-message.ts.
 */
export class GitApiError extends Error {
  readonly status: number
  readonly issues: GitFieldIssue[]

  constructor(status: number, body: string) {
    super(`git-http ${status}: ${body}`)
    this.name = 'GitApiError'
    this.status = status
    this.issues = parseIssues(body)
  }
}

/** Never throws: a non-JSON or unexpected body yields no issues, and the caller falls back
 *  to a status-only message. Enforced by packages/git-http/test/git-api-error.test.ts. */
function parseIssues(body: string): GitFieldIssue[] {
  try {
    const parsed: unknown = JSON.parse(body)
    const raw = (parsed as { issues?: unknown }).issues
    if (!Array.isArray(raw)) return []
    return raw.flatMap((i) => {
      const o = i as Partial<GitFieldIssue>
      return typeof o?.message === 'string'
        ? [
            {
              path: typeof o.path === 'string' ? o.path : '',
              field: typeof o.field === 'string' ? o.field : '',
              message: o.message
            }
          ]
        : []
    })
  } catch {
    return []
  }
}

export interface HttpGitOptions {
  /** Base URL of the Setu git API (e.g. http://localhost:4444). */
  baseUrl: string
  /** Injectable fetch (tests wire this to an in-process Hono app). Defaults to global fetch. */
  fetch?: typeof fetch
}

/** A GitPort that talks to the Setu git API (apps/api) over HTTP.
 *  Browser-safe: only uses fetch. Same GitPort contract as git-local/idb/memory. */
export function createHttpGitPort(opts: HttpGitOptions): GitPort {
  const base = opts.baseUrl.replace(/\/$/, '')
  const doFetch = opts.fetch ?? fetch
  const url = (path: string) => `${base}${path}`

  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = await res.text()
      throw new GitApiError(res.status, body)
    }
    return (await res.json()) as T
  }

  const commitFiles = async (
    input: CommitFilesInput
  ): Promise<CommitResult> => {
    const { sha } = await json<{ sha: string }>(
      await doFetch(url('/git/commit-files'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input)
      })
    )
    return { sha }
  }

  return {
    async headSha() {
      const { sha } = await json<{ sha: string | null }>(
        await doFetch(url('/git/head'))
      )
      return sha
    },
    async readFile(path) {
      const { content } = await json<{ content: string | null }>(
        await doFetch(url(`/git/file?path=${encodeURIComponent(path)}`))
      )
      return content
    },
    commitFile(input: CommitInput): Promise<CommitResult> {
      return commitFiles({
        changes: [{ path: input.path, content: input.content }],
        message: input.message,
        author: input.author
      })
    },
    commitFiles,
    async list(prefix?: string) {
      const q =
        prefix === undefined ? '' : `?prefix=${encodeURIComponent(prefix)}`
      const { paths } = await json<{ paths: string[] }>(
        await doFetch(url(`/git/list${q}`))
      )
      return paths
    },
    async diffPaths(fromSha: string, toSha: string) {
      const { changes } = await json<{ changes: DiffPathEntry[] }>(
        await doFetch(
          url(
            `/git/diff?from=${encodeURIComponent(fromSha)}&to=${encodeURIComponent(toSha)}`
          )
        )
      )
      return changes
    }
  }
}
