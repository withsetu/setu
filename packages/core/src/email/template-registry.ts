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
  /**
   * Which of {@link renderEmailTemplate}'s three arms produced `text` — `'stored'` (an explicit
   * `override.text`), `'derived'` (from an overridden HTML body) or `'shipped'` (the type's
   * hand-written `defaultText`).
   *
   * Reported rather than re-derivable, because only the renderer knows: the arm depends on
   * whether each override cleared BOTH gates AND, for the derived arm, on whether the derivation
   * came out non-empty. The admin editor tells the admin which plain-text part their email will
   * carry, and computing that from the predicates alone made the help text contradict the preview
   * panel beside it (#920 review F2). Pinned by apps/admin/test/email-templates.test.tsx ("says
   * the plain-text part is the shipped one for a body that derives to nothing") and
   * packages/core/test/email/email-registry.test.ts ("text part").
   */
  textSource: 'stored' | 'derived' | 'shipped'
  /**
   * Whether `html` came from the admin's override (`'stored'`) or the shipped default
   * (`'shipped'`) — the same question {@link RenderedEmail.textSource} answers for `text`, and
   * reported for the same reason: an override can be rejected by either gate, so "did the admin
   * change the body" is not answerable from the override object alone.
   *
   * The editor needs BOTH to explain the plain-text part honestly. `textSource: 'shipped'` with
   * `htmlSource: 'stored'` is the third arm — the admin DID change the body, and the text part
   * still does not follow it — and saying "it only follows this HTML once you change the HTML"
   * there would be false (#920 review F2). Pinned by apps/admin/test/email-templates.test.tsx
   * ("explains that a wordless body has no text to extract").
   */
  htmlSource: 'stored' | 'shipped'
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
 * biggest template Setu ships). The subject cap is well past the ~78-char line most clients
 * truncate at, and is re-applied to the RENDERED subject by {@link renderEmailTemplate} (#935),
 * because a single token can expand a within-cap template without limit.
 *
 * "No one can turn settings.json into a payload store" needs all four caps, not just these two,
 * and until #935 it was a claim with nothing behind it: a stored override is
 * `.partial().passthrough()`, so a field this build does not know went through unmeasured, and
 * nothing bounded the number of entries. `salvageEmailTemplates` in ../settings/schema.ts now
 * measures the whole serialized entry against {@link EMAIL_TEMPLATE_MAX_ENTRY_BYTES} and caps the
 * entry count at {@link EMAIL_TEMPLATE_MAX_ENTRIES}; both are pinned by
 * packages/core/src/settings/email-settings.test.ts ("the whole entry is bounded (#935)").
 */
export const EMAIL_TEMPLATE_MAX_BODY = 20_000
export const EMAIL_TEMPLATE_MAX_SUBJECT = 300

/**
 * The serialized ceiling on ONE stored override, unknown fields included (#935).
 *
 * Chosen so it can never reject an entry whose known fields are all legal, which is what lets it
 * be a flat number rather than a per-field sum. The worst case is NOT the 2x that quotes,
 * backslashes and newlines cost: `JSON.stringify` emits `\u00XX` for C0 control characters and
 * for lone surrogates, i.e. 6x. A maximal legal entry — {@link EMAIL_TEMPLATE_MAX_SUBJECT} plus
 * 2 x {@link EMAIL_TEMPLATE_MAX_BODY} characters, all U+0001 — serializes to exactly 241,834
 * characters (measured), against 80,634 for the same entry made of quotes. 256 KB clears the real
 * worst case; the 100 KB this started at would have rejected it, which is what made "can never
 * reject" false when it was first written. Both directions are pinned by
 * packages/core/src/settings/email-settings.test.ts ("keeps an entry whose known fields all sit
 * at their own caps", which includes the control-character row, and "drops an entry whose unknown
 * fields blow the entry cap").
 */
export const EMAIL_TEMPLATE_MAX_ENTRY_BYTES = 256_000

/**
 * The ceiling on how many overrides `email.templates` may hold (#935).
 *
 * Core ships two types and a plugin adds a handful; 64 is far past any real installation and far
 * below a useful payload store. Unknown ids are deliberately KEPT (a plugin may not be loaded
 * yet), which is exactly why the COUNT needs its own bound — without one, "keep what you don't
 * recognise" is an unbounded write primitive.
 */
export const EMAIL_TEMPLATE_MAX_ENTRIES = 64

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
 * is what makes "a broken override can never send a blank subject or body" true; before #920
 * that gate did not exist and a typo'd token shipped blank-subject password-reset emails.
 * Both gates are enforced by packages/core/test/email/email-registry.test.ts
 * ("override resolution" for this one, "the render-time floor" for the other).
 *
 * Note the narrow claim: BLANK, not "garbage". Neither gate says the output is sensible — a
 * near-miss like `{{reset-url}}` (a hyphen is not `\w`, so it never matches the token grammar)
 * renders as literal braces, which is non-blank and passes both. Tracked in #924.
 *
 * Module-level export, deliberately NOT on the package barrel: it has no consumer outside core.
 * The admin used to call it to say which plain-text part an email would carry, and got the answer
 * wrong for one arm — that question is now answered by {@link RenderedEmail.textSource}, which
 * the renderer reports rather than anyone re-deriving (#920 review F2). The barrel exports
 * {@link renderTemplateField} instead, which is the gate the editor genuinely shares.
 */
export const isUsableTemplateField = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.length <= max

const usable = isUsableTemplateField

/** The three parts of an email, each of which renders in its own context. */
export type EmailTemplateField = 'subject' | 'html' | 'text'

/**
 * How each field is filled — a subject is `singleLine` (a mail header, so CR/LF is stripped from
 * template and values alike) and only the HTML part escapes substituted values.
 *
 * Intended as the single source of truth for the render options, so that a shipped default and an
 * admin's override cannot be filled differently. Nothing in the type system stops a future call
 * site from inlining its own options instead. What IS enforced is the load-bearing half of that
 * intent — `singleLine` on BOTH subject paths — by
 * packages/core/test/email/email-registry.test.ts: "a subject override cannot inject a mail
 * header" (the override path) and "a token value cannot inject a mail header into the subject"
 * (the default path, where the CR/LF arrives through a token value).
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
 * The ceiling on each RENDERED part of an email — the `html` and the `text` (#950).
 *
 * {@link EMAIL_TEMPLATE_MAX_BODY} bounds the stored template STRING and the forms boundary bounds
 * each submitted value, and neither bounds the OUTPUT: `formNotificationValues` HTML-escapes every
 * submitted name and value (correctly — that escaping is the only thing between an anonymous
 * submitter and the operator's mail client), and escaping is expansive. One `&` in the request buys
 * five characters (`&amp;`) in the render. So a submission can satisfy every input cap at once and
 * still render megabytes: measured at exactly the #935 caps (100 fields, 200-character names,
 * 10,000-character values, all `&`), a 1,020,865-byte request body rendered 5,035,997 characters of
 * HTML and 1,020,568 of text — 4.93x.
 *
 * 64,000 is chosen against the largest render a LEGITIMATE at-cap submission produces: one field at
 * the 10,000-character value cap renders 50,565 characters of HTML (measured; both numbers are
 * pinned by packages/core/test/email/email-registry.test.ts, "the rendered body is capped (#950)").
 * So the ceiling sits above any real notification while cutting the adversarial case by ~79x.
 *
 * Note what this is NOT: it is not a claim that a trimmed email is a good email. It is the
 * difference between "the notification body is bounded at ~4.9 MiB" and "bounded at 64,000
 * characters, and it says so when it cuts".
 *
 * Module-level export, deliberately NOT on the package barrel — the same posture as
 * {@link isUsableTemplateField}. Unlike {@link EMAIL_TEMPLATE_MAX_BODY}, which the settings schema
 * and the admin's template editor both validate against, this one has no consumer outside core:
 * every caller reaches it through {@link renderEmailTemplate}, which is the point.
 */
export const EMAIL_RENDERED_MAX_BODY = 64_000

/** The trim notice, in the words an operator can act on: their form is receiving submissions far
 *  larger than a form is for. `rendered` is the real pre-trim length, so the scale is visible. */
const trimNotice = (rendered: number): string =>
  `… trimmed here: this email rendered ${rendered} characters, over the ${EMAIL_RENDERED_MAX_BODY}-character limit.`

/**
 * Cut a rendered part to `limit` characters without leaving a broken tail.
 *
 * Three backoffs, in order — and only the last two are guarantees:
 * - **A line boundary**, when one falls in the last quarter of the window. The `{{fields}}` block is
 *   newline-joined rows, so this usually lands between whole rows. Stated as a PREFERENCE on
 *   purpose: it makes the common trim tidier, and deleting it breaks no test, because the two
 *   backoffs below already keep the output well-formed without it (checked — the kill-shot for this
 *   line passes, which is why it is not described as something the output depends on).
 * - **A half-written tag or character reference** (html only), when the hard cut lands mid-markup.
 *   Submitter content is escaped BEFORE the cut, so a cut can never manufacture a tag out of
 *   submitted text — the risk is not injection, it is that an unterminated `<td style="…` would
 *   swallow the trim notice appended after it into an attribute and tell the operator nothing. Both
 *   halves are separately kill-shot tested by packages/core/test/email/email-registry.test.ts
 *   ("never leaves a half-written tag or character reference").
 * - **A surrogate pair**, never split, for the same reason {@link capSubject} does not split one
 *   (same file, "never cuts an astral character in half").
 */
const cutTo = (s: string, limit: number, isHtml: boolean): string => {
  let cut = s.slice(0, limit)
  const nl = cut.lastIndexOf('\n')
  if (nl >= limit * 0.75) {
    cut = cut.slice(0, nl)
  } else if (isHtml) {
    const lt = cut.lastIndexOf('<')
    if (lt > cut.lastIndexOf('>')) cut = cut.slice(0, lt)
    const amp = cut.lastIndexOf('&')
    // A character reference is short; anything further back is a literal `&amp;`-escaped ampersand
    // that has already been closed.
    if (amp > cut.lastIndexOf(';') && cut.length - amp <= 10)
      cut = cut.slice(0, amp)
  }
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return cut.trimEnd()
}

/**
 * Apply {@link EMAIL_RENDERED_MAX_BODY} to one rendered part, with a visible marker (#950).
 *
 * Applied inside {@link renderEmailTemplate} rather than at either call site for exactly the reason
 * {@link capSubject} is: the admin's live preview and the server's send are the same function (see
 * the preview-parity note at the top of this file), so a cap on one side only would make the
 * preview a lie — and epic #497 rests on that parity.
 *
 * The notice is generic rather than "…and N more fields": this function renders password-reset mail
 * too and knows nothing about fields. What it can say honestly, it does — that the email was cut
 * here, and how big it came out.
 */
const capBody = (s: string, isHtml: boolean): string => {
  if (s.length <= EMAIL_RENDERED_MAX_BODY) return s
  const notice = isHtml
    ? `\n<p style="font-family:system-ui,sans-serif;font-size:12px;color:#71717a;margin:16px 0 0">${trimNotice(s.length)}</p>`
    : `\n\n${trimNotice(s.length)}`
  return (
    cutTo(s, Math.max(0, EMAIL_RENDERED_MAX_BODY - notice.length), isHtml) +
    notice
  )
}

/**
 * Truncate a RENDERED subject to the bound a stored template already obeys (#935).
 *
 * {@link EMAIL_TEMPLATE_MAX_SUBJECT} bounds the template STRING; a single token can still expand
 * it without limit, and `New submission: {{form_label}}` fills that token straight from an
 * unauthenticated request body. So the bound has to be re-applied to the bytes that go into the
 * header: RFC 5322 caps a header LINE at 998 octets, and a relay that rejects the message takes
 * the operator's notification with it.
 *
 * Applied here rather than at either call site because the admin's live preview and the server's
 * send are the same function (see the preview-parity note at the top of this file) — a cap on one
 * side only would make the preview a lie. The ellipsis is deliberate: an operator seeing a cut
 * subject should be able to tell it was cut.
 *
 * The cut never splits an astral character. `slice` works in UTF-16 code units, so cutting between
 * a surrogate pair would put a LONE surrogate into a mail header — an unencodable code unit on a
 * value that is about to be MIME-encoded, which is a different failure from "the subject is
 * long". {@link htmlToPlainText}'s ceiling can concede its mid-tag cut because a stray tag is
 * inert; a header cannot. Pinned by packages/core/test/email/email-registry.test.ts ("the
 * rendered subject is capped (#935)").
 */
const capSubject = (s: string): string => {
  if (s.length <= EMAIL_TEMPLATE_MAX_SUBJECT) return s
  const cut = s.slice(0, EMAIL_TEMPLATE_MAX_SUBJECT - 1)
  const last = cut.charCodeAt(cut.length - 1)
  const whole = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
  return `${whole.trimEnd()}…`
}

/**
 * Render one email: the admin's override where it is usable, the shipped default everywhere
 * else, with `{{token}}` substitution through the shared engine.
 *
 * - **subject** — text context, `singleLine`, then {@link capSubject}. A subject is a mail header,
 *   so CR/LF is stripped from both the template and every substituted value, and the RESULT is
 *   length-bounded — a token value can expand a within-cap template without limit (#935).
 * - **html** — html context: every value is escaped unless the type's vocabulary declares the
 *   token `rawHtml`. The result is bounded by {@link capBody}, because escaping AMPLIFIES: the same
 *   reasoning as the subject, one layer out (#950).
 * - **text** — THREE arms, reported as {@link RenderedEmail.textSource}:
 *   1. `'stored'` — an explicit `override.text` that cleared both gates wins.
 *   2. `'derived'` — otherwise, when the HTML was overridden AND that HTML derives a non-empty
 *      plain-text part, the text is DERIVED from the rendered HTML so the two parts of a
 *      customized email cannot disagree.
 *   3. `'shipped'` — otherwise the type's hand-written `defaultText`.
 *
 *   The third arm catches more than "no override": markup can be perfectly good HTML and still
 *   derive NOTHING (an image-only body has no words in it). Pairing a customized HTML part with
 *   the shipped text is normally the exact mismatch {@link htmlToPlainText} exists to prevent, so
 *   this is a deliberate trade — an empty text part is worse than a stale one, because a
 *   text-only client would render a blank message, while the shipped text at least says what the
 *   email is for. Pinned by packages/core/test/email/email-registry.test.ts ("an overridden body
 *   whose text derivation is empty falls back to the shipped text").
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

  const subject = capSubject(
    rendered(o.subject, 'subject', EMAIL_TEMPLATE_MAX_SUBJECT) ??
      shipped(def.defaultSubject, 'subject')
  )
  // The OVERRIDDEN html, once it has cleared both gates — null when there is no usable override,
  // which is also what decides the text part's arm below. An override that renders to nothing is
  // not a customization, so its text part must not be derived from those empty bytes either.
  const overriddenHtml = rendered(o.html, 'html', EMAIL_TEMPLATE_MAX_BODY)
  const html = capBody(overriddenHtml ?? shipped(def.defaultHtml, 'html'), true)
  // Markup with no words in it (an image-only body) is a usable, non-blank HTML override whose
  // DERIVATION is empty — the third arm in the docblock above.
  //
  // #950: derived from the CAPPED html, not from the override's full render. Two reasons, and the
  // first is the load-bearing one: a text part carrying rows the html part trimmed away would make
  // the two halves of one email disagree, which is the exact mismatch htmlToPlainText exists to
  // prevent. It also means this derivation never sees more than EMAIL_RENDERED_MAX_BODY characters,
  // well inside htmlToPlainText's own HTML_TO_TEXT_MAX_INPUT ceiling (#941).
  const derivedText =
    overriddenHtml === null ? null : htmlToPlainText(html) || null
  const storedText = rendered(o.text, 'text', EMAIL_TEMPLATE_MAX_BODY)
  // Capped independently: the shipped `defaultText` carries `{{fields}}` too, so the text part can
  // be over the ceiling on a submission whose html part is not (and vice versa).
  const text = capBody(
    storedText ?? derivedText ?? shipped(def.defaultText, 'text'),
    false
  )
  // Decided HERE, from the same three values the arm above selected between, so no caller has to
  // re-derive it (and get it wrong — #920 review F2).
  const textSource =
    storedText !== null
      ? 'stored'
      : derivedText !== null
        ? 'derived'
        : 'shipped'
  return {
    subject,
    html,
    text,
    textSource,
    htmlSource: overriddenHtml === null ? 'shipped' : 'stored'
  }
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
