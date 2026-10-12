import { CONTACT_DEFAULT_TEXT, type ContactText } from '@setu/core'

export const DEFAULT_SUCCESS_MESSAGE = CONTACT_DEFAULT_TEXT.successMessage

/** The visitor-facing text a contact block will render for `key`: the author's override
 *  when it is a non-blank string, the shared default otherwise — the same rule the
 *  published island applies (#1248). */
export function contactText(
  mdAttrs: Record<string, unknown>,
  key: keyof ContactText
): string {
  const v = mdAttrs[key]
  return typeof v === 'string' && v.trim() !== ''
    ? v
    : CONTACT_DEFAULT_TEXT[key]
}

/** Markdoc may deliver booleans as the strings "true"/"false". Normalize. */
export function coerceBool(v: unknown, dflt: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return dflt
}

/** A stable, opaque form id. Authors never see/edit this; it attributes
 *  submissions in the inbox and must survive form-name renames. */
export function genFormId(): string {
  return `contact-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

/** Return mdAttrs guaranteed to carry a formId (generating one if absent). */
export function ensureFormId(
  mdAttrs: Record<string, unknown>
): Record<string, unknown> {
  const cur = mdAttrs.formId
  if (typeof cur === 'string' && cur !== '') return mdAttrs
  return { ...mdAttrs, formId: genFormId() }
}

export type PreviewField = {
  name: 'name' | 'email' | 'subject' | 'message'
  label: string
  type: 'text' | 'email' | 'textarea'
  required: boolean
}

/** The fields the rendered form will show, derived purely from attributes.
 *  Email + message are always required; subject appears only when enabled. */
export function contactPreviewFields(
  mdAttrs: Record<string, unknown>
): PreviewField[] {
  const subject = coerceBool(mdAttrs.subject, false)
  const nameRequired = coerceBool(mdAttrs.nameRequired, true)
  const subjectRequired = coerceBool(mdAttrs.subjectRequired, false)
  const fields: PreviewField[] = [
    {
      name: 'name',
      label: contactText(mdAttrs, 'nameLabel'),
      type: 'text',
      required: nameRequired
    },
    {
      name: 'email',
      label: contactText(mdAttrs, 'emailLabel'),
      type: 'email',
      required: true
    }
  ]
  if (subject)
    fields.push({
      name: 'subject',
      label: contactText(mdAttrs, 'subjectLabel'),
      type: 'text',
      required: subjectRequired
    })
  fields.push({
    name: 'message',
    label: contactText(mdAttrs, 'messageLabel'),
    type: 'textarea',
    required: true
  })
  return fields
}
