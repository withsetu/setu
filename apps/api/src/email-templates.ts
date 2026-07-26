import {
  EMAIL_TYPES,
  renderRegisteredEmail,
  type EmailTemplateOverrides,
  type EmailTypeRegistry,
  type RenderedEmail,
  type SiteSettings,
  type TokenValues
} from '@setu/core'

/** The half of an `EmailConfig` (./email-config.ts) a render needs. Named structurally so this
 *  module keeps depending on no other, which is what lets the pure renderer below be exercised
 *  without a settings file. */
export interface TemplateSource {
  templates: EmailTemplateOverrides | undefined
  siteTitle: string | undefined
}

export interface LiveEmailTemplates {
  /** Render one registered email type with whatever override is stored RIGHT NOW — one settings
   *  read per call. The live entry point, for a caller that has no reading in hand. */
  render(typeId: string, values: TokenValues): RenderedEmail
  /** #939: render against a reading ALREADY resolved — the template seam's exact counterpart to
   *  `EmailDispatcher.sendVia`, and for the same reason. Every send path in
   *  apps/api/src/server.ts resolves an `EmailConfig` once and renders through this, so the
   *  from-address, the transport and the body all come from ONE parse of settings.json instead of
   *  three (apps/api/test/email-read-count.test.ts counts them per path). */
  renderWith(
    source: TemplateSource,
    typeId: string,
    values: TokenValues
  ): RenderedEmail
}

/**
 * #499 (epic #497): the live template resolver — the template half of what `liveFrom` (#498)
 * and the live provider selection (#890) already do for the from-address and the transport.
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
  /** Live getter for the WHOLE settings object — one read per render, deliberately, not one per
   *  field it needs. Form notifications are visitor-triggered and that path already parses
   *  settings.json once for the from-address; a getter per token source would have made a single
   *  submission parse it three times (pinned by apps/api/test/email-templates.test.ts, "reads
   *  settings exactly ONCE per render"). May throw (unreadable file) — treated as "nothing
   *  stored", which sends the shipped default rather than failing the send. */
  settings: () => SiteSettings
  /** Defaults to core's registry. Injectable so a test — or, once #302's extension seam lands,
   *  a plugin host — can supply a registry with extra types registered. */
  registry?: EmailTypeRegistry
}): LiveEmailTemplates {
  const registry = opts.registry ?? EMAIL_TYPES
  const renderWith: LiveEmailTemplates['renderWith'] = (
    source,
    typeId,
    values
  ) =>
    // Ambient values first so an explicit one from the caller wins — the send paths know
    // more about their own context than this resolver does.
    renderRegisteredEmail(registry, typeId, source.templates, {
      ...(source.siteTitle === undefined
        ? {}
        : { site_title: source.siteTitle }),
      ...values
    })
  return {
    renderWith,
    render(typeId, values) {
      let settings: SiteSettings | undefined
      try {
        settings = opts.settings()
      } catch {
        settings = undefined
      }
      // `|| 'Setu'` is the SAME fallback resolve-seo.ts applies to `general.title`, so an empty
      // General title does not make `{{site_title}}` vanish from an email while the site's own
      // <title> still says "Setu" (apps/api/test/email-templates.test.ts, 'falls back to "Setu"
      // for an empty site title'). resolveEmailConfig in ./email-config.ts applies the same
      // fallback for the callers that resolve a whole config; the two are kept identical by
      // apps/api/test/email-config.test.ts ("matches createLiveEmailTemplates' own site-title
      // fallback").
      return renderWith(
        {
          templates: settings?.email.templates,
          siteTitle:
            settings === undefined
              ? undefined
              : settings.general.title || 'Setu'
        },
        typeId,
        values
      )
    }
  }
}
