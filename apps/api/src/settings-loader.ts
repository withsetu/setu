import { parseSettingsWithWarnings } from '@setu/core'
import type { SiteSettings } from '@setu/core'

/**
 * #937: settings.json, read the way apps/site reads it — with the salvage warnings.
 *
 * The api previously used the warnings-free `parseSettings`, so every reason the salvage layer
 * had for resetting a stored key was thrown away. That is the same silence #656 rejected on the
 * site side ("a silently-reset key silently changes what the site publishes"), and the email wave
 * widened what it hides: a `git push`-ed `provider: "sendgrid"` hands transport selection back to
 * the environment, an oversized template sends the shipped default, an invalid `fromAddress`
 * falls back — each one indistinguishable, from the log, from never having been configured.
 *
 * The api cannot just log them all like the site build does, because it re-reads settings.json
 * per email and per capabilities request (#939): one bad stored template would print once per
 * message, on a path a visitor can trigger. So this borrows the "log only when the problem
 * changes" idiom from createLiveEmailTransport (./email-transport.ts) and reports a warning set
 * only when it DIFFERS from the last one reported — first read included, which is the boot log.
 *
 * `read` returns the file's text and may throw; an unreadable or unparseable file yields defaults
 * and reports nothing, exactly as before — there is no salvaged key to name in that case.
 * Every branch is pinned by apps/api/test/settings-loader.test.ts.
 */
export function createSettingsLoader(opts: {
  read: () => string
  /** Called with the whole warning set, in emission order, when that set changes. */
  onWarnings: (warnings: string[]) => void
}): () => SiteSettings {
  let reported: string | null = null
  return () => {
    let raw: unknown
    try {
      raw = JSON.parse(opts.read()) as unknown
    } catch {
      raw = undefined
    }
    const { settings, warnings } = parseSettingsWithWarnings(raw)
    // Sorted: two files carrying the same complaints in a different key order are the same
    // problem, and re-logging on a reorder would defeat the point of the guard.
    const key = [...warnings].sort().join('\n')
    if (key !== reported) {
      reported = key
      if (warnings.length > 0) opts.onWarnings(warnings)
    }
    return settings
  }
}
