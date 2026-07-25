import { useEffect, useRef, useState } from 'react'
import {
  EMAIL_TYPES,
  renderEmailTemplate,
  renderTemplateField,
  unknownTokensIn,
  EMAIL_TEMPLATE_MAX_BODY,
  EMAIL_TEMPLATE_MAX_SUBJECT,
  type EmailTemplateField,
  type EmailTemplateOverride,
  type EmailTemplateOverrides,
  type EmailTypeDefinition
} from '@setu/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

/**
 * Settings → Email · the template editor (#499, epic #497).
 *
 * One card per registered email type: subject + HTML body, a token palette that INSERTS at the
 * cursor, a live preview and reset-to-default. Reference shape: WooCommerce's per-email
 * subject/heading/content editor with its "available placeholders" hint, upgraded from a hint
 * to a clickable palette and a real preview.
 *
 * The load-bearing property is PREVIEW PARITY: the preview is produced by @setu/core's
 * `renderEmailTemplate` — literally the function apps/api calls on every send — over the type's
 * own `sampleValues`. There is no UI-side rendering path that could drift from the mail that
 * goes out; apps/admin/test/email-templates.test.tsx asserts the frame's srcDoc IS core's
 * output, so a hand-rolled preview would fail it.
 *
 * Storage shape: only fields that DIFFER from the shipped default are kept, and a type with no
 * differing field is absent from `email.templates` entirely. So an untouched template keeps
 * inheriting future improvements to the shipped default instead of freezing today's copy.
 */

/** The template fields this editor exposes — core's `EmailTemplateField` minus `text`, which has
 *  no control here (it is shown read-only under the preview and only honored when hand-written
 *  into settings.json). Derived from core's union rather than re-typed, so a field added there
 *  surfaces as a typecheck decision here instead of silently going unedited. */
type FieldName = Exclude<EmailTemplateField, 'text'>

export interface TemplateFieldErrors {
  subject?: string
  html?: string
}

/**
 * Per-type, per-field validation — the same rules the settings schema and the renderer enforce,
 * surfaced here so the admin finds out before saving rather than by silently getting the default
 * back. Two of them:
 *
 * 1. the size caps, and
 * 2. **renders-to-nothing** (#920). A template can be non-empty, well within cap and still
 *    produce no bytes at all: unknown tokens are stripped and the token grammar is
 *    case-sensitive, so `{{Reset_Url}}` is a perfectly valid string that renders to ''. Stored,
 *    that used to mean every password-reset email went out with a blank subject line.
 *
 * The emptiness question is answered by core's `renderTemplateField` — literally the function the
 * renderer calls per field — so the RULE cannot drift from the server's. The ANSWER still can,
 * and deliberately: this screen renders the type's `sampleValues`, while the server renders the
 * values of a real send. A subject of exactly `{{user_name}}` therefore saves cleanly here (the
 * sample name is "Ada Lovelace") and falls back at send time for a user with no display name —
 * which is precisely why the render-time floor in `renderEmailTemplate`, not this check, is the
 * layer that must hold. It is also the layer that catches an override arriving by `git push`,
 * settings.json being Git-canonical. This is the authoring-time HALF of the fix.
 * Pinned by apps/admin/test/email-templates.test.tsx ("blocks saving a subject that renders to
 * nothing and says why").
 *
 * A type id with no registered definition is skipped: a plugin's type may simply not be loaded,
 * and there is no vocabulary to render it against.
 */
export function validateEmailTemplates(
  overrides: EmailTemplateOverrides
): Record<string, TemplateFieldErrors> {
  const out: Record<string, TemplateFieldErrors> = {}
  for (const [id, o] of Object.entries(overrides)) {
    const errs: TemplateFieldErrors = {}
    const def = EMAIL_TYPES.get(id)
    const rendersToNothing = (field: FieldName, tpl: string): boolean =>
      def !== undefined &&
      renderTemplateField(def, field, tpl, def.sampleValues) === null
    if (
      typeof o.subject === 'string' &&
      o.subject.length > EMAIL_TEMPLATE_MAX_SUBJECT
    )
      errs.subject = `Too long — subjects are limited to ${EMAIL_TEMPLATE_MAX_SUBJECT} characters.`
    else if (
      typeof o.subject === 'string' &&
      rendersToNothing('subject', o.subject)
    )
      errs.subject = EMPTY_RENDER_ERROR('subject')
    if (typeof o.html === 'string' && o.html.length > EMAIL_TEMPLATE_MAX_BODY)
      errs.html = `Too long — bodies are limited to ${EMAIL_TEMPLATE_MAX_BODY.toLocaleString()} characters.`
    else if (typeof o.html === 'string' && rendersToNothing('html', o.html))
      errs.html = EMPTY_RENDER_ERROR('body')
    if (errs.subject !== undefined || errs.html !== undefined) out[id] = errs
  }
  return out
}

/** Says what is wrong, why it is wrong, and what Setu would do instead — the token grammar is
 *  case-sensitive, which is the overwhelmingly likely cause. */
const EMPTY_RENDER_ERROR = (part: 'subject' | 'body'): string =>
  `This renders to nothing, so Setu would send the shipped ${part} instead. Token names are case-sensitive — check them against the list below.`

/** Stable serialization for the dirty-compare: key order in a JSON object is not meaningful,
 *  so sort before stringifying or a reordered save would look like a change. */
export function templatesFingerprint(
  overrides: EmailTemplateOverrides
): string {
  return JSON.stringify(
    Object.keys(overrides)
      .sort()
      .map((id) => {
        const o = overrides[id] as EmailTemplateOverride
        return [id, o.subject ?? null, o.html ?? null, o.text ?? null]
      })
  )
}

/** True when this type has anything stored at all — drives the Customized badge and whether
 *  Reset to default has something to do. */
const isCustomized = (o: EmailTemplateOverride | undefined): boolean =>
  o !== undefined && Object.keys(o).length > 0

function TokenPalette({
  def,
  onInsert
}: {
  def: EmailTypeDefinition
  onInsert: (token: string) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Tokens you can use</p>
      <p className="text-xs text-muted-foreground">
        Click one to insert it where your cursor is. A token you don&rsquo;t use
        is simply left out.
      </p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {def.tokens.map((t) => (
          <li key={t.name}>
            <button
              type="button"
              // Keep the caret: mousedown-prevent stops the field from blurring, so the
              // insertion point is exactly where the admin left it. Keyboard activation still
              // works — a browser preserves selectionStart across blur, so tabbing to the chip
              // and pressing Enter inserts at the same place.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onInsert(t.name)}
              aria-label={`Insert {{${t.name}}} — ${t.description}`}
              className="flex w-full flex-col gap-0.5 rounded-md border border-transparent px-2 py-1.5 text-left hover:border-border hover:bg-muted focus-visible:border-border focus-visible:bg-muted focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
            >
              <code className="font-mono text-xs text-foreground">{`{{${t.name}}}`}</code>
              <span className="text-xs text-muted-foreground">
                {t.description}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TemplateCard({
  def,
  override,
  errors,
  onChange,
  onReset,
  onInsert,
  onFocusField,
  registerField
}: {
  def: EmailTypeDefinition
  override: EmailTemplateOverride | undefined
  errors: TemplateFieldErrors | undefined
  onChange: (field: FieldName, value: string) => void
  onReset: () => void
  onInsert: (token: string) => void
  onFocusField: (field: FieldName) => void
  registerField: (field: FieldName, el: HTMLElement | null) => void
}) {
  const subject = override?.subject ?? def.defaultSubject
  const html = override?.html ?? def.defaultHtml
  const customized = isCustomized(override)
  const preview = renderEmailTemplate(def, override, def.sampleValues)
  // Which of renderEmailTemplate's three text-part arms actually applied — READ from the render
  // this card is already showing, never re-decided here. Re-deciding from the predicates got it
  // wrong for the third arm (a usable, non-blank body whose derivation is empty), so the help
  // text claimed "generated from this HTML" while the preview panel below showed the shipped
  // text (#920 review F2, apps/admin/test/email-templates.test.tsx — "says the plain-text part is
  // the shipped one for a body that derives to nothing").
  const textPartSource = preview.textSource
  const unknown = [
    ...new Set([
      ...unknownTokensIn(subject, def.tokens),
      ...unknownTokensIn(html, def.tokens)
    ])
  ]

  const subjectId = `tpl-${def.id}-subject`
  const bodyId = `tpl-${def.id}-body`

  return (
    <section aria-label={def.label} className="space-y-5 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-medium">{def.label}</h3>
            <Badge variant={customized ? 'default' : 'secondary'}>
              {customized ? 'Customized' : 'Using the shipped default'}
            </Badge>
          </div>
          <p className="max-w-prose text-sm text-muted-foreground">
            {def.description}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!customized}
          // ONE state update, not two field resets: two sequential onChange calls would both
          // read the same `overrides` prop, so the second would resurrect the first field's
          // override (apps/admin/test/email-templates.test.tsx, "reset-to-default clears the
          // stored override", saves and re-reads settings.json to catch exactly that).
          onClick={onReset}
        >
          Reset to default
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={subjectId}>Subject</Label>
            <Input
              id={subjectId}
              ref={(el) => registerField('subject', el)}
              value={subject}
              onFocus={() => onFocusField('subject')}
              onChange={(e) => onChange('subject', e.target.value)}
              aria-invalid={errors?.subject !== undefined}
              aria-describedby={
                errors?.subject === undefined ? undefined : `${subjectId}-error`
              }
            />
            {errors?.subject !== undefined && (
              <p id={`${subjectId}-error`} className="text-sm text-destructive">
                {errors.subject}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={bodyId}>Body (HTML)</Label>
            <Textarea
              id={bodyId}
              ref={(el) => registerField('html', el)}
              value={html}
              rows={12}
              spellCheck={false}
              className="font-mono text-xs leading-relaxed"
              onFocus={() => onFocusField('html')}
              onChange={(e) => onChange('html', e.target.value)}
              aria-invalid={errors?.html !== undefined}
              aria-describedby={
                errors?.html === undefined
                  ? `${bodyId}-help`
                  : `${bodyId}-error`
              }
            />
            {errors?.html !== undefined ? (
              <p id={`${bodyId}-error`} className="text-sm text-destructive">
                {errors.html}
              </p>
            ) : (
              <p
                id={`${bodyId}-help`}
                className="text-xs text-muted-foreground"
              >
                {textPartSource === 'stored'
                  ? `The plain-text version sent alongside it comes from email.templates.${def.id}.text in settings.json — you can see it under the preview.`
                  : textPartSource === 'derived'
                    ? 'The plain-text version sent alongside it is generated from this HTML — you can see it under the preview.'
                    : preview.htmlSource === 'stored'
                      ? // The third arm: the body IS overridden, but there are no words in it to
                        // extract, so saying "once you change the HTML" would be false — they did.
                        'This body has no text to extract, so the plain-text version sent alongside it is the one Setu ships. Add some words outside the markup and it will follow this HTML instead.'
                      : 'The plain-text version sent alongside it is the one Setu ships — it only follows this HTML once you change the HTML. You can see it under the preview.'}
              </p>
            )}
          </div>

          {unknown.length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              {`Unknown ${unknown.length === 1 ? 'token' : 'tokens'} ${unknown
                .map((t) => `{{${t}}}`)
                .join(
                  ', '
                )} — ${unknown.length === 1 ? 'it' : 'they'} will render as nothing.`}
            </p>
          )}

          <TokenPalette def={def} onInsert={onInsert} />
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Preview</p>
            <p className="text-xs text-muted-foreground">
              Rendered with example data by the same code that sends the real
              email.
            </p>
          </div>
          <div className="overflow-hidden rounded-md border">
            <div className="border-b bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">Subject</p>
              <p className="text-sm font-medium break-words">
                {preview.subject}
              </p>
            </div>
            {/* Sandboxed with NO allow-scripts: the body is admin-authored HTML and must never
                execute in the admin's origin. Pinned by
                apps/admin/test/email-templates.test.tsx ("renders the preview in a script-less
                sandboxed frame"). White background because that is what a mail client gives an
                email — this frame shows the email, not the admin theme. */}
            <iframe
              title={`HTML preview — ${def.label}`}
              sandbox=""
              srcDoc={preview.html}
              className="block h-72 w-full bg-white"
            />
          </div>
          <details className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer text-sm">
              Plain-text version
            </summary>
            <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap text-muted-foreground">
              {preview.text}
            </pre>
          </details>
        </div>
      </div>
    </section>
  )
}

export function EmailTemplates({
  overrides,
  errors,
  onChange
}: {
  overrides: EmailTemplateOverrides
  errors: Record<string, TemplateFieldErrors>
  onChange: (next: EmailTemplateOverrides) => void
}) {
  // typeId:field → the live DOM node, so a palette click can read the caret and write back.
  const fields = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement>>(
    {}
  )
  const [focused, setFocused] = useState<{
    typeId: string
    field: FieldName
  } | null>(null)
  // `typeId:field` keys that have held the caret at least once. Needed because a never-focused
  // input reports `selectionStart === 0` rather than null — see insertToken.
  const touched = useRef(new Set<string>())
  const caret = useRef<{ key: string; pos: number } | null>(null)

  // Restore focus and place the caret AFTER the inserted token, once React has committed the
  // new value — otherwise the controlled re-render would drop the caret to the end.
  useEffect(() => {
    const pending = caret.current
    if (pending === null) return
    caret.current = null
    const el = fields.current[pending.key]
    if (el === undefined) return
    el.focus()
    el.setSelectionRange(pending.pos, pending.pos)
  })

  const setField = (
    def: EmailTypeDefinition,
    field: FieldName,
    value: string
  ) => {
    const current = overrides[def.id] ?? {}
    const shipped = field === 'subject' ? def.defaultSubject : def.defaultHtml
    const next: EmailTemplateOverrides = { ...overrides }
    // Only a value that DIFFERS from the shipped default is stored; matching it again removes
    // the override, and an entry with nothing left in it disappears entirely.
    const entry: EmailTemplateOverride = { ...current }
    if (value === shipped) delete entry[field]
    else entry[field] = value
    if (Object.keys(entry).length === 0) delete next[def.id]
    else next[def.id] = entry
    onChange(next)
  }

  /**
   * Which field a palette click should write into. Two signals, in this order:
   *
   * 1. `document.activeElement` — ground truth at click time, and the normal case: the palette
   *    button prevents mousedown, so the field never loses focus.
   * 2. the last field that fired `onFocus` in this card — the KEYBOARD case, where activating
   *    the chip means focus has moved to the chip itself.
   *
   * Body when neither applies, which is where an admin who hasn't touched either field would
   * want it. All three paths are covered by apps/admin/test/email-templates.test.tsx's
   * "token palette" describe.
   */
  const targetField = (defId: string): FieldName => {
    const active = document.activeElement
    for (const f of ['subject', 'html'] as const)
      if (active !== null && fields.current[`${defId}:${f}`] === active)
        return f
    if (focused !== null && focused.typeId === defId) return focused.field
    return 'html'
  }

  const insertToken = (def: EmailTypeDefinition, token: string) => {
    const field = targetField(def.id)
    const key = `${def.id}:${field}`
    const el = fields.current[key]
    if (el === undefined) return
    const snippet = `{{${token}}}`
    // A field the admin has never put the caret in has `selectionStart === 0` — NOT null — so
    // the caret alone cannot distinguish "at the very start" from "no caret yet". Reading it
    // anyway inserted at position 0, i.e. BEFORE the whole template. Hence the explicit
    // `touched` set: never focused ⇒ append at the end; focused even once ⇒ honor the caret,
    // including after a blur. Both halves are pinned by
    // apps/admin/test/email-templates.test.tsx ("appends at the end of a body that has never
    // been focused" / "still inserts at the caret of a field that was focused and then blurred").
    // `caretAt === null` means "there is no caret to honor", from either of two causes: the
    // admin has never focused this field, or the element does not support selection at all
    // (`selectionStart` is `number | null` in the DOM lib — unreachable for our text/textarea,
    // kept because the type says so). Both append at the end.
    const caretAt = touched.current.has(key) ? el.selectionStart : null
    const start = caretAt ?? el.value.length
    const end =
      caretAt === null ? el.value.length : (el.selectionEnd ?? caretAt)
    caret.current = { key, pos: start + snippet.length }
    setField(
      def,
      field,
      el.value.slice(0, start) + snippet + el.value.slice(end)
    )
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-medium">Email templates</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Customize what Setu&rsquo;s emails say. Changes apply to the next
          email as soon as you save — no rebuild or redeploy. Reset a template
          at any time to go back to the one Setu ships.
        </p>
      </div>
      {EMAIL_TYPES.list().map((def) => (
        <TemplateCard
          key={def.id}
          def={def}
          override={overrides[def.id]}
          errors={errors[def.id]}
          onChange={(field, value) => setField(def, field, value)}
          onReset={() => {
            const next = { ...overrides }
            delete next[def.id]
            onChange(next)
          }}
          onInsert={(token) => insertToken(def, token)}
          onFocusField={(field) => {
            touched.current.add(`${def.id}:${field}`)
            setFocused({ typeId: def.id, field })
          }}
          registerField={(field, el) => {
            const key = `${def.id}:${field}`
            if (el === null) delete fields.current[key]
            else
              fields.current[key] = el as HTMLInputElement | HTMLTextAreaElement
          }}
        />
      ))}
    </div>
  )
}
