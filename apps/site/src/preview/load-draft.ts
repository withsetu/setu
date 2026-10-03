import { z } from 'zod'

/** The draft the editor pushed to the api's preview slot (apps/api/src/preview.ts). */
const previewDraftSchema = z.object({
  content: z.string(),
  collection: z.string(),
  locale: z.string(),
  slug: z.string()
})
export type PreviewDraft = z.infer<typeof previewDraftSchema>

/** Why the preview couldn't be loaded — each one is a FAILURE, never "nothing to preview". */
export type PreviewErrorReason =
  'unreachable' | 'server' | 'disabled' | 'malformed'

export type PreviewLoad =
  | { kind: 'draft'; draft: PreviewDraft }
  /** The api answered, and nothing has been pushed yet. The ONLY outcome that is "empty". */
  | { kind: 'empty' }
  | {
      kind: 'error'
      reason: PreviewErrorReason
      title: string
      message: string
    }

export interface LoadPreviewOptions {
  /** Abort a request the api never answers, so the page reports it instead of hanging. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000

/** One line for the dev terminal: `fetch failed` alone hides WHY (ECONNREFUSED, ENOTFOUND…), and
 *  the full error object prints a stack trace on every reload. */
function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) return ''
  const inner: unknown = cause.cause
  let detail = ''
  if (inner instanceof Error) {
    const code = (inner as Error & { code?: unknown }).code
    detail = typeof code === 'string' ? code : inner.message
  }
  return ` (${cause.message}${detail ? `: ${detail}` : ''})`
}

/** Fetch the current preview draft and classify the outcome (#1123).
 *
 *  Only a 404 carrying the api's `empty: true` marker is `empty`. A bare 404 means the preview
 *  route isn't mounted (the api's gate is off), which is a failure the user can act on, as are an
 *  unreachable api, a non-2xx answer and a body that isn't a draft. Every failure is logged with
 *  `console.warn` so the dev terminal shows it as well as the page.
 *  One case per outcome: apps/site/test/preview-load-draft.test.ts. */
export async function loadPreviewDraft(
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
  opts: LoadPreviewOptions = {}
): Promise<PreviewLoad> {
  const endpoint = `${apiUrl}/preview`
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const fail = (
    reason: PreviewErrorReason,
    title: string,
    message: string,
    cause?: unknown
  ): PreviewLoad => {
    console.warn(`[preview] ${title} — ${message}${describeCause(cause)}`)
    return { kind: 'error', reason, title, message }
  }

  let res: Response
  try {
    res = await fetchImpl(endpoint, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    const timedOut =
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError')
    return fail(
      'unreachable',
      "Couldn't reach the Setu API",
      timedOut
        ? `The API at ${apiUrl} didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`
        : `Nothing answered at ${apiUrl}. Check the API is running (pnpm dev starts it) and that SETU_API_URL points at it.`,
      err
    )
  }

  if (res.status === 404) {
    const body: unknown = await res.json().catch(() => null)
    if (
      body &&
      typeof body === 'object' &&
      (body as { empty?: unknown }).empty === true
    ) {
      return { kind: 'empty' }
    }
    return fail(
      'disabled',
      'Preview is turned off on this API',
      `The API at ${apiUrl} has no preview endpoint. In-editor preview runs only when the API is in local mode and not in production.`
    )
  }

  if (!res.ok) {
    return fail(
      'server',
      'The Setu API returned an error',
      `Loading the preview from ${apiUrl} failed with HTTP ${res.status}.`
    )
  }

  let body: unknown
  try {
    body = await res.json()
  } catch (err) {
    return fail(
      'malformed',
      "The preview couldn't be read",
      `The API at ${apiUrl} sent a response that isn't valid JSON (it may have been cut off).`,
      err
    )
  }
  const parsed = previewDraftSchema.safeParse(body)
  if (!parsed.success) {
    return fail(
      'malformed',
      "The preview couldn't be read",
      `The API at ${apiUrl} sent a response that isn't a preview draft.`
    )
  }
  return { kind: 'draft', draft: parsed.data }
}
