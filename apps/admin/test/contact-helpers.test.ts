import { describe, it, expect } from 'vitest'
import {
  coerceBool,
  genFormId,
  ensureFormId,
  contactPreviewFields,
  contactText
} from '../src/editor/extensions/contact-helpers'

describe('coerceBool', () => {
  it('passes through real booleans and coerces Markdoc string booleans', () => {
    expect(coerceBool(true, false)).toBe(true)
    expect(coerceBool(false, true)).toBe(false)
    expect(coerceBool('true', false)).toBe(true)
    expect(coerceBool('false', true)).toBe(false)
  })
  it('falls back to the default for undefined/garbage', () => {
    expect(coerceBool(undefined, true)).toBe(true)
    expect(coerceBool(undefined, false)).toBe(false)
    expect(coerceBool('nonsense', true)).toBe(true)
  })
})

describe('genFormId / ensureFormId', () => {
  it('generates a non-empty contact-prefixed id', () => {
    const id = genFormId()
    expect(id).toMatch(/^contact-[0-9a-f]+$/)
  })
  it('adds a formId when absent, preserves an existing one', () => {
    const added = ensureFormId({ subject: true })
    expect(typeof added.formId).toBe('string')
    expect((added.formId as string).length).toBeGreaterThan(0)
    expect(added.subject).toBe(true)
    const kept = ensureFormId({ formId: 'contact-keepme' })
    expect(kept.formId).toBe('contact-keepme')
  })
})

describe('contactPreviewFields', () => {
  it('omits subject when subject is off; email + message always required', () => {
    const fields = contactPreviewFields({ subject: false, nameRequired: true })
    expect(fields.map((f) => f.name)).toEqual(['name', 'email', 'message'])
    expect(fields.find((f) => f.name === 'email')!.required).toBe(true)
    expect(fields.find((f) => f.name === 'message')!.required).toBe(true)
    expect(fields.find((f) => f.name === 'name')!.required).toBe(true)
  })
  it('includes subject when on, and reflects per-field required toggles', () => {
    const fields = contactPreviewFields({
      subject: true,
      nameRequired: false,
      subjectRequired: true
    })
    expect(fields.map((f) => f.name)).toEqual([
      'name',
      'email',
      'subject',
      'message'
    ])
    expect(fields.find((f) => f.name === 'name')!.required).toBe(false)
    expect(fields.find((f) => f.name === 'subject')!.required).toBe(true)
    expect(fields.find((f) => f.name === 'message')!.type).toBe('textarea')
  })
  it('coerces Markdoc string booleans', () => {
    const fields = contactPreviewFields({
      subject: 'true',
      nameRequired: 'false'
    })
    expect(fields.map((f) => f.name)).toContain('subject')
    expect(fields.find((f) => f.name === 'name')!.required).toBe(false)
  })
})

// #1248: the in-canvas preview shows the visitor text the published form will render —
// the author's override when set, the shared CONTACT_DEFAULT_TEXT otherwise.
describe('contact visitor text (#1248)', () => {
  it('previews author labels, falling back to the defaults for blank/unset ones', () => {
    const fields = contactPreviewFields({
      subject: true,
      nameLabel: 'Nom',
      emailLabel: '',
      subjectLabel: 'Objet'
    })
    expect(fields.map((f) => f.label)).toEqual([
      'Nom',
      'Email',
      'Objet',
      'Message'
    ])
  })
  it('resolves the button text the same way', () => {
    expect(contactText({}, 'submitLabel')).toBe('Send')
    expect(contactText({ submitLabel: '' }, 'submitLabel')).toBe('Send')
    expect(contactText({ submitLabel: 'Envoyer' }, 'submitLabel')).toBe(
      'Envoyer'
    )
  })
})
