import {
  fillTemplate,
  htmlToPlainText,
  type FillOptions,
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
 *   motivation for the epic. Parity is a claim about the EDITOR, so exactly one test can
 *   enforce it: apps/admin/test/email-templates.test.tsx asserts the preview frame's srcDoc IS
 *   this function's output, and fails the moment anyone hand-rolls a UI-side renderer. (This
 *   comment used to name packages/core/test/email/email-registry.test.ts's "preview parity"
 *   block as well; that block compared this function to itself and could not fail — #922. It
 *   now freezes the shipped defaults' rendered bytes instead, which is a different property.)
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

/**
 * True when a stored override field is usable AS STORED: a string with real content, within its
 * cap. Absent, empty, whitespace-only, wrong type and oversized all mean "use the shipped
 * default".
 *
 * This is the first of TWO gates and it sees only the template STRING — it says nothing about
 * what that string renders to. A template can pass here and still produce nothing at all
 * (unknown tokens are stripped, and the grammar is case-sensitive, so `{{Reset_Url}}` is a
 * perfectly usable string that renders to ''). The second gate, {@link renderTemplateField},
 * is what makes "a broken override can never send garbage" true; before #920 that gate did not
 * exist and a typo'd token shipped blank-subject password-reset emails.
 * Both gates are enforced by packages/core/test/email/email-registry.test.ts
 * ("override resolution" for this one, "the render-time floor" for the other).
 *
 * Exported because the admin editor needs the SAME answer to describe what it is about to send
 * (e.g. whether the plain-text part will be derived from an overridden HTML body or is the
 * shipped one). A second copy of this predicate in the UI would be free to drift from the one
 * the server actually applies, which is the class of bug this whole epic removes.
 */
export const isUsableTemplateField = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.length <= max

const usable = isUsableTemplateField

/** The three parts of an email, each of which renders in its own context. */
export type EmailTemplateField = 'subject' | 'html' | 'text'

/**
 * How each field is filled. Single source of truth for the render options, so the shipped
 * default and an admin's override are always rendered the same way — a subject is `singleLine`
 * (a mail header, so CR/LF is stripped from template and values alike) and only the HTML part
 * escapes substituted values.
 */
const fillOptionsFor = (
  def: EmailTypeDefinition,
  field: EmailTemplateField
): FillOptions =>
  field === 'html'
    ? { context: 'html', vocabulary: def.tokens }
    : {
        context: 'text',
        vocabulary: def.tokens,
        singleLine: field === 'subject'
      }

/**
 * Render one template string in its field's context — or `null` when it renders to NOTHING.
 *
 * The floor under a stored override (#920). {@link isUsableTemplateField} inspects the template
 * string; this inspects the bytes that would actually be sent, which is the only check that
 * catches a well-formed template whose tokens all strip to empty. A `null` here means the caller
 * uses the shipped default instead. That deliberately overrides a DELIBERATELY empty override
 * too: a subject line with nothing in it is not a legitimate email, and an admin who wants a
 * short subject can write one.
 *
 * Exported because the admin editor needs the same answer to refuse a Save
 * (`validateEmailTemplates` in apps/admin/src/screens/settings/EmailTemplates.tsx) — a second
 * copy of the rule in the UI would be free to drift from the one the server applies. Enforced by
 * packages/core/test/email/email-registry.test.ts ("the render-time floor") and, at the editor
 * end, by apps/admin/test/email-templates.test.tsx.
 */
export function renderTemplateField(
  def: EmailTypeDefinition,
  field: EmailTemplateField,
  tpl: string,
  values: TokenValues
): string | null {
  const out = fillTemplate(tpl, values, fillOptionsFor(def, field))
  return out.trim() === '' ? null : out
}

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
 *
 * An override has to clear BOTH gates to be used: usable as stored
 * ({@link isUsableTemplateField}) and non-blank once rendered ({@link renderTemplateField}).
 * A field that fails either one falls back to the shipped default on its own, so a dead subject
 * never costs a good body (#920, packages/core/test/email/email-registry.test.ts —
 * "the render-time floor").
 */
export function renderEmailTemplate(
  def: EmailTypeDefinition,
  override: EmailTemplateOverride | undefined,
  values: TokenValues
): RenderedEmail {
  const o = override ?? {}
  const rendered = (
    tpl: unknown,
    field: EmailTemplateField,
    max: number
  ): string | null =>
    usable(tpl, max) ? renderTemplateField(def, field, tpl, values) : null
  const shipped = (tpl: string, field: EmailTemplateField): string =>
    fillTemplate(tpl, values, fillOptionsFor(def, field))

  const subject =
    rendered(o.subject, 'subject', EMAIL_TEMPLATE_MAX_SUBJECT) ??
    shipped(def.defaultSubject, 'subject')
  // The OVERRIDDEN html, once it has cleared both gates — null when there is no usable override,
  // which is also what decides the text part's arm below. An override that renders to nothing is
  // not a customization, so its text part must not be derived from those empty bytes either.
  const overriddenHtml = rendered(o.html, 'html', EMAIL_TEMPLATE_MAX_BODY)
  const html = overriddenHtml ?? shipped(def.defaultHtml, 'html')
  const derivedText =
    overriddenHtml === null ? null : htmlToPlainText(overriddenHtml) || null
  const text =
    rendered(o.text, 'text', EMAIL_TEMPLATE_MAX_BODY) ??
    derivedText ??
    shipped(def.defaultText, 'text')
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
