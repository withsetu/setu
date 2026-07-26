import type { EmailTemplateOverrides, SiteSettings } from '@setu/core'
import {
  resolveFromAddress,
  usableEmailTransport,
  type FromAddressResolution,
  type UsableEmailTransport
} from './capabilities'

/**
 * Everything one email needs from settings.json + the environment, resolved together (#939).
 *
 * Every field here used to be reached through its own live getter — `liveFrom` (#498),
 * `liveProvider` (#890) and the template resolver's whole-settings getter (#499) — and each of
 * those parsed settings.json independently. Sending one message therefore cost three full parses
 * (`readFileSync` + `JSON.parse` + six Zod group parses + salvage), four on the password-reset
 * path, and the count grew with the number of RESOLUTION CONCERNS rather than with the number of
 * emails: a future reply-to or per-form sender would have added a fourth and a fifth for free.
 * On the form-notification path that was three synchronous, event-loop-blocking parses per
 * anonymous visitor request, which is the shape CLAUDE.md §1 calls out as per-visitor fan-out.
 *
 * What this is NOT: a cache. The resolution still happens INSIDE each send, so a save in
 * Settings → Email still applies to the next email with no api restart — the wave's headline
 * property. It collapses four readings of one file into one reading; it never hoists the reading
 * out of the send. Both halves are pinned by apps/api/test/email-read-count.test.ts, which counts
 * settings reads per send path AND drives a save between two sends on each of them.
 */
export interface EmailConfig {
  /** #498: settings.json's `email.fromAddress` wins, `SETU_FORMS_NOTIFY_FROM` is the fallback. */
  from: FromAddressResolution
  /** #890: the transport the NEXT send would use, already fail-safed to console when the
   *  selection is unusable. This is the whole reading, not just `effective`, because callers hand
   *  it straight to `LiveEmailTransport.sendVia` so the decision binds the dispatch (#919). */
  transport: UsableEmailTransport
  /** #499: the admin's stored template overrides, or undefined when settings could not be read
   *  at all (which renders the shipped defaults). */
  templates: EmailTemplateOverrides | undefined
  /** `{{site_title}}`, with the same `|| 'Setu'` fallback resolve-seo.ts applies to
   *  `general.title` — undefined only when settings could not be read. */
  siteTitle: string | undefined
}

/** Pure projection of one settings reading. `undefined` settings means "could not be read",
 *  which every field degrades on rather than failing the send — the same fail-safe-at-the-point-
 *  of-use layering `createLiveEmailTransport` and `createLiveEmailTemplates` each had on their
 *  own. Pinned by apps/api/test/email-config.test.ts. */
export function resolveEmailConfig(
  settings: SiteSettings | undefined,
  env: NodeJS.ProcessEnv
): EmailConfig {
  return {
    from: resolveFromAddress(settings?.email.fromAddress, env),
    transport: usableEmailTransport(env, settings?.email.provider),
    templates: settings?.email.templates,
    siteTitle:
      settings === undefined ? undefined : settings.general.title || 'Setu'
  }
}

/**
 * The live reading: one `settings()` call per invocation, so callers get a fresh answer per send
 * while paying for a single parse.
 *
 * `settings()` may throw (an unreadable or corrupt settings.json) — treated as "nothing stored",
 * which is the pre-#939 behaviour of all three getters this replaces: a broken file must not take
 * email down. Pinned by apps/api/test/email-config.test.ts ("a throwing settings getter degrades
 * to env-only rather than failing the send").
 */
export function createLiveEmailConfig(opts: {
  settings: () => SiteSettings
  env?: NodeJS.ProcessEnv
}): () => EmailConfig {
  const env = opts.env ?? process.env
  return () => {
    let settings: SiteSettings | undefined
    try {
      settings = opts.settings()
    } catch {
      settings = undefined
    }
    return resolveEmailConfig(settings, env)
  }
}
