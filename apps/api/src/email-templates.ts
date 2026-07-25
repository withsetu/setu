import {
  EMAIL_TYPES,
  renderRegisteredEmail,
  type EmailTemplateOverrides,
  type EmailTypeRegistry,
  type RenderedEmail,
  type TokenValues
} from '@setu/core'

export interface LiveEmailTemplates {
  /** Render one registered email type with whatever override is stored RIGHT NOW. */
  render(typeId: string, values: TokenValues): RenderedEmail
}

/**
 * #499 (epic #497): the live template resolver — the template half of what `liveFrom` (#498)
 * and `createLiveEmailTransport` (#890) already do for the from-address and the provider.
 *
 * Deliberately the SAME mechanism, not a second one: a thunk that re-reads settings.json on
 * every send, so saving a template in Settings → Email applies to the next email with no api
 * restart, exactly like saving a from-address does. Every send path — password reset and form
 * notifications — goes through this one object, so "which override applies" has a single
 * answer. Pinned by apps/api/test/email-templates.test.ts.
 *
 * Fail-safe, at the point of USE. A settings.json that cannot be read or parsed must not take
 * email down, so a throwing getter degrades to "no overrides" (= the shipped defaults); a
 * malformed override degrades per FIELD inside renderEmailTemplate. That layering matters
 * because settings.json is Git-canonical: a template can arrive by `git push` without ever
 * passing the api's settings-write gate, so the save-time Zod check can never be the only
 * defence — the same reasoning as #890's usableEmailTransport.
 */
export function createLiveEmailTemplates(opts: {
  /** Live getter for settings.json's `email.templates`. May throw (unreadable file) — treated
   *  as "no overrides stored", which sends the shipped default rather than failing the send. */
  overrides: () => EmailTemplateOverrides | undefined
  /** Live getter for Settings → General's site title, folded in as `{{site_title}}` for every
   *  type that declares the token. Optional; a caller-supplied value always wins. */
  siteTitle?: () => string
  /** Defaults to core's registry. Injectable so a test — or, once #302's extension seam lands,
   *  a plugin host — can supply a registry with extra types registered. */
  registry?: EmailTypeRegistry
}): LiveEmailTemplates {
  const registry = opts.registry ?? EMAIL_TYPES
  return {
    render(typeId, values) {
      let stored: EmailTemplateOverrides | undefined
      try {
        stored = opts.overrides()
      } catch {
        stored = undefined
      }
      let siteTitle: string | undefined
      try {
        siteTitle = opts.siteTitle?.()
      } catch {
        siteTitle = undefined
      }
      // Ambient values first so an explicit one from the caller wins — the send paths know
      // more about their own context than this resolver does.
      return renderRegisteredEmail(registry, typeId, stored, {
        ...(siteTitle === undefined ? {} : { site_title: siteTitle }),
        ...values
      })
    }
  }
}
