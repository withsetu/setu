import {
  fillTemplate,
  htmlToPlainText,
  type TokenSpec,
  type TokenValues
} from '../templating/fill-template'

/**
 * The email TYPE registry (#499, epic #497).
 *
 * Every email Setu sends is a named type carrying its own token vocabulary and its shipped
 * default template. Two things follow from that:
 *
 * - **One renderer.** The admin's live preview and the server's send path both call
 *   {@link renderEmailTemplate} with the same definition, override and values, so a preview
 *   that disagrees with the delivered mail is structurally impossible. That was the whole
 *   motivation for the epic; it is pinned by packages/core/test/email/email-registry.test.ts
 *   ("preview parity") and by apps/admin/test/email-templates.test.tsx, which asserts the
 *   rendered preview equals this function's output.
 * - **A plugin surface.** A type is data plus two pure functions, so #302's extension seam can
 *   let a plugin call {@link EmailTypeRegistry.register} with zero changes here. Core's own two
 *   types go through that same public call (see ./templates/index.ts) rather than a privileged
 *   internal path — which is what keeps the third-party road tested (same test file, "accepts a
 *   third-party type through the public register()"). Plugin LOADING is not built here.
 */
export interface EmailTypeDefinition {
  /** Stable id; also the settings key (`email.templates.<id>`). Kebab-case by convention. */
  id: string
  /** Human label for the editor, e.g. "Password reset". */
  label: string
  /** One or two sentences: when this email is sent, and to whom. */
  description: string
  /** The type's whole token vocabulary — the editor palette, and the list that decides which
   *  values skip HTML escaping (`rawHtml`). */
  tokens: readonly TokenSpec[]
  defaultSubject: string
  defaultHtml: string
  /** The hand-written plain-text part. Preferred over deriving text from the HTML whenever the
   *  HTML has not been overridden — see {@link renderEmailTemplate}. */
  defaultText: string
  /** Token values for the editor's live preview. Built by the type's own value builder from a
   *  representative sample, so the preview exercises the same value SHAPES a real send does
   *  (a `{ html, text }` pair stays a pair). */
  sampleValues: TokenValues
}

/** What an admin stored for one type in `settings.json`'s `email.templates.<id>`. Every field
 *  is optional and every field falls back INDEPENDENTLY: a bad subject does not cost a good
 *  body. `text` has no editor control today (the editor edits subject + HTML body and shows the
 *  derived text part read-only) but is honored when hand-written into settings.json. */
export interface EmailTemplateOverride {
  subject?: string
  html?: string
  text?: string
}

/** The `email.templates` map: type id → override. */
export type EmailTemplateOverrides = Record<string, EmailTemplateOverride>

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/**
 * Size caps for a stored override. They exist because `settings.json` is Git-canonical: a
 * template can arrive by `git push` without ever passing the api's settings-write gate, so a
 * save-time check alone could never be the only defence (the same reasoning as #890's
 * usableEmailTransport). Enforced in BOTH places — the settings schema drops an oversized
 * template with a warning at parse time, and {@link renderEmailTemplate} falls back to the
 * default at render time even if one somehow reaches it.
 *
 * The body cap is generous enough for a rich HTML email (roughly 20 KB, several times the
 * biggest template Setu ships) and small enough that no one can turn settings.json into a
 * payload store. The subject cap is well past the ~78-char line most clients truncate at.
 */
export const EMAIL_TEMPLATE_MAX_BODY = 20_000
export const EMAIL_TEMPLATE_MAX_SUBJECT = 300

export const EMAIL_TYPE_PASSWORD_RESET = 'password-reset'
export const EMAIL_TYPE_FORM_NOTIFICATION = 'form-notification'

export interface EmailTypeRegistry {
  /** Add a type. Throws on a duplicate id rather than shadowing one silently — a plugin that
   *  collides with core (or another plugin) must find out at load time. */
  register(def: EmailTypeDefinition): void
  get(id: string): EmailTypeDefinition | undefined
  /** Registration order, which is also the order the editor lists them in. */
  list(): EmailTypeDefinition[]
}

export function createEmailTypeRegistry(): EmailTypeRegistry {
  const types = new Map<string, EmailTypeDefinition>()
  return {
    register(def) {
      if (types.has(def.id))
        throw new Error(`email type "${def.id}" is already registered`)
      types.set(def.id, def)
    },
    get: (id) => types.get(id),
    list: () => [...types.values()]
  }
}

/** True when a stored override field is usable: a string with real content, within its cap.
 *  Everything else — absent, empty, whitespace-only, wrong type, oversized — means "use the
 *  shipped default", which is the DoD promise that a broken override can never send garbage. */
const usable = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.length <= max

/**
 * Render one email: the admin's override where it is usable, the shipped default everywhere
 * else, with `{{token}}` substitution through the shared engine.
 *
 * - **subject** — text context, `singleLine`. A subject is a mail header, so CR/LF is stripped
 *   from both the template and every substituted value.
 * - **html** — html context: every value is escaped unless the type's vocabulary declares the
 *   token `rawHtml`.
 * - **text** — an explicit `override.text` wins; otherwise, when the HTML was overridden, the
 *   text part is DERIVED from the rendered HTML so the two parts of a customized email cannot
 *   disagree; otherwise the type's hand-written `defaultText`.
 */
export function renderEmailTemplate(
  def: EmailTypeDefinition,
  override: EmailTemplateOverride | undefined,
  values: TokenValues
): RenderedEmail {
  const o = override ?? {}
  const subjectTpl = usable(o.subject, EMAIL_TEMPLATE_MAX_SUBJECT)
    ? o.subject
    : def.defaultSubject
  const htmlTpl = usable(o.html, EMAIL_TEMPLATE_MAX_BODY) ? o.html : null
  const textTpl = usable(o.text, EMAIL_TEMPLATE_MAX_BODY) ? o.text : null

  const subject = fillTemplate(subjectTpl, values, {
    context: 'text',
    vocabulary: def.tokens,
    singleLine: true
  })
  const html = fillTemplate(htmlTpl ?? def.defaultHtml, values, {
    context: 'html',
    vocabulary: def.tokens
  })
  const text =
    textTpl !== null
      ? fillTemplate(textTpl, values, {
          context: 'text',
          vocabulary: def.tokens
        })
      : htmlTpl !== null
        ? htmlToPlainText(html)
        : fillTemplate(def.defaultText, values, {
            context: 'text',
            vocabulary: def.tokens
          })
  return { subject, html, text }
}

/**
 * Resolve + render in one call, from the raw `email.templates` map as stored in settings.json.
 *
 * This is the seam every send path uses (see apps/api/src/email-templates.ts's live resolver),
 * so "which override applies" is answered in exactly one place. An unknown id throws: the
 * caller names a type it registered, and a typo there would otherwise mean silently sending the
 * wrong email.
 */
export function renderRegisteredEmail(
  registry: EmailTypeRegistry,
  id: string,
  overrides: EmailTemplateOverrides | undefined,
  values: TokenValues
): RenderedEmail {
  const def = registry.get(id)
  if (def === undefined) throw new Error(`unknown email type "${id}"`)
  return renderEmailTemplate(def, overrides?.[id], values)
}
