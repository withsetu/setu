import type { GitPort, CommitInput, CommitResult } from '@setu/core'

export interface HttpGitOptions {
  /** Base URL of the Saytu git API (e.g. http://localhost:4444). */
  baseUrl: string
  /** Injectable fetch (tests wire this to an in-process Hono app). Defaults to global fetch. */
  fetch?: typeof fetch
}

/** A GitPort that talks to the Saytu git API (apps/saytu-api) over HTTP.
 *  Browser-safe: only uses fetch. Same GitPort contract as git-local/idb/memory. */
export function createHttpGitPort(opts: HttpGitOptions): GitPort {
  const base = opts.baseUrl.replace(/\/$/, '')
  const doFetch = opts.fetch ?? fetch
  const url = (path: string) => `${base}${path}`

  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`git-http ${res.status}: ${body}`)
    }
    return (await res.json()) as T
  }

  return {
    async headSha() {
      const { sha } = await json<{ sha: string | null }>(await doFetch(url('/git/head')))
      return sha
    },
    async readFile(path) {
      const { content } = await json<{ content: string | null }>(
        await doFetch(url(`/git/file?path=${encodeURIComponent(path)}`)),
      )
      return content
    },
    async commitFile(input: CommitInput): Promise<CommitResult> {
      const { sha } = await json<{ sha: string }>(
        await doFetch(url('/git/commit'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      )
      return { sha }
    },
    async list(prefix?: string) {
      const q = prefix === undefined ? '' : `?prefix=${encodeURIComponent(prefix)}`
      const { paths } = await json<{ paths: string[] }>(await doFetch(url(`/git/list${q}`)))
      return paths
    },
  }
}
