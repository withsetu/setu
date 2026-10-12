// packages/blocks/src/contact/endpoint.ts
import { resolveContactApiBase } from '@setu/core'

let warned = false

/** Resolve the contact island's API origin for the current build (#1248) and, when a
 *  production build has none, warn once — the form will render as unavailable rather than
 *  post to localhost. Called from the contact block's renderer for every instance, so the
 *  module-level flag keeps one build to one warning. Pinned by
 *  packages/blocks/test/contact-endpoint.test.ts. */
export function contactApiBaseForBuild(
  configured: string | undefined,
  isDev: boolean,
  warn: (message: string) => void = console.warn
): string | null {
  const base = resolveContactApiBase(configured, isDev)
  if (base === null && !warned) {
    warned = true
    warn(
      '[setu] contact block: PUBLIC_SETU_API_BASE is not set, so contact forms in this ' +
        'build render as unavailable ("This form isn\'t available right now."). Set it to ' +
        'the origin of your Setu API to accept submissions.'
    )
  }
  return base
}
