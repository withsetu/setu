import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  EMAIL_TEMPLATE_MAX_BODY,
  parseSettings
} from '@setu/core'
import type { EmailSettings as EmailValues } from '@setu/core'
import { patchEmailGroup } from '../src/screens/settings/email-settings-patch'

/**
 * #937: Settings → Email loaded the SALVAGED email group and then wrote it back whole, so a
 * stored value the salvage layer had rejected — an oversized template, a namespaced template id
 * that fails EMAIL_TYPE_ID, a `git push`-ed `provider: "sendgrid"` — was erased by the next
 * unrelated save, with "Settings saved" shown. This is the patch that replaced that write: only
 * what the admin actually CHANGED is written, over the raw stored group.
 */

/** The screen's own load path: `parseSettings(raw).email` is what lands in state. */
const loaded = (raw: Record<string, unknown>): EmailValues =>
  parseSettings(raw).email

const withField = (
  v: EmailValues,
  patch: Partial<EmailValues>
): EmailValues => ({
  ...v,
  ...patch
})

describe('patchEmailGroup (#937)', () => {
  it('writes the changed from-address', () => {
    const raw = { email: { fromAddress: 'old@example.com' } }
    const published = loaded(raw)
    const out = patchEmailGroup(
      raw.email,
      published,
      withField(published, { fromAddress: 'new@example.com' })
    )
    expect(out.fromAddress).toBe('new@example.com')
  })

  // THE #937 case: the provider is not what the admin touched, so it must not be rewritten from
  // the salvaged reading (which is DEFAULT_SETTINGS.email.provider, i.e. '').
  it('a from-address save does not erase a stored provider the salvage layer rejected', () => {
    const raw = {
      email: { fromAddress: 'old@example.com', provider: 'sendgrid' }
    }
    const published = loaded(raw)
    expect(published.provider).toBe(DEFAULT_SETTINGS.email.provider) // salvage dropped it
    const out = patchEmailGroup(
      raw.email,
      published,
      withField(published, { fromAddress: 'new@example.com' })
    )
    expect(out.fromAddress).toBe('new@example.com')
    expect(out.provider).toBe('sendgrid')
  })

  it('a from-address save does not erase a from-address the salvage layer rejected either', () => {
    // Not a contradiction: the admin is saving a NEW address, so the field IS written. This
    // pins the sibling case — a provider save must leave the rejected address alone.
    const raw = {
      email: { fromAddress: 'not-an-address', provider: 'console' }
    }
    const published = loaded(raw)
    expect(published.fromAddress).toBe('')
    const out = patchEmailGroup(
      raw.email,
      published,
      withField(published, { provider: 'smtp' })
    )
    expect(out.provider).toBe('smtp')
    expect(out.fromAddress).toBe('not-an-address')
  })

  it('a namespaced template id that fails EMAIL_TYPE_ID survives an unrelated save', () => {
    const raw = {
      email: {
        fromAddress: 'old@example.com',
        templates: { 'myplugin:welcome': { subject: 'Hi' } }
      }
    }
    const published = loaded(raw)
    expect(published.templates['myplugin:welcome']).toBeUndefined() // dropped at parse
    const out = patchEmailGroup(
      raw.email,
      published,
      withField(published, { fromAddress: 'new@example.com' })
    )
    expect(out.templates).toEqual({ 'myplugin:welcome': { subject: 'Hi' } })
  })

  // Editing ONE template must not take the rejected sibling with it — that is the case a naive
  // "write the whole salvaged templates map" fix would still lose.
  it('editing one template keeps a rejected sibling entry', () => {
    const raw = {
      email: {
        templates: {
          'myplugin:welcome': { subject: 'Hi' },
          'password-reset': { subject: 'Old' }
        }
      }
    }
    const published = loaded(raw)
    const out = patchEmailGroup(
      raw.email,
      published,
      withField(published, {
        templates: {
          ...published.templates,
          'password-reset': { subject: 'New' }
        }
      })
    )
    expect(out.templates).toEqual({
      'myplugin:welcome': { subject: 'Hi' },
      'password-reset': { subject: 'New' }
    })
  })

  it('reset-to-default still deletes the entry the admin cleared', () => {
    const raw = {
      email: {
        templates: {
          'myplugin:welcome': { subject: 'Hi' },
          'password-reset': { subject: 'Old' }
        }
      }
    }
    const published = loaded(raw)
    const next = { ...published.templates }
    delete next['password-reset']
    const out = patchEmailGroup(
      raw.email,
      published,
      withField(published, { templates: next })
    )
    expect(out.templates).toEqual({ 'myplugin:welcome': { subject: 'Hi' } })
  })

  // Two distinct salvage outcomes, both of which the old whole-group write erased:
  // an over-cap FIELD hollows the entry out to `{}` (EMAIL_TEMPLATE_MAX_BODY), while an
  // over-cap ENTRY is dropped whole (EMAIL_TEMPLATE_MAX_ENTRY_BYTES).
  it('an over-cap template body survives a from-address-only save', () => {
    const huge = 'x'.repeat(EMAIL_TEMPLATE_MAX_BODY + 1)
    const raw = {
      email: {
        fromAddress: 'a@b.co',
        templates: { 'password-reset': { html: huge } }
      }
    }
    const published = loaded(raw)
    expect(published.templates['password-reset']).toEqual({}) // the body was dropped
    const out = patchEmailGroup(
      raw.email,
      published,
      withField(published, { fromAddress: 'c@d.co' })
    )
    expect(out.templates).toEqual({ 'password-reset': { html: huge } })
  })

  /**
   * #978 review F2 — THE case that decides whether `email` needs its own patcher, and the one the
   * old design argument never tested.
   *
   * The argument for a per-ENTRY atom rule rested on the entry salvage rejects WHOLE. That case
   * cannot distinguish the two rules: a rejected-whole entry is absent from `published`, so there
   * is no object pair to recurse into and both rules replace the entry whole ("customizing an id
   * whose stored entry salvage rejected replaces the stored entry", above, passes under either).
   *
   * The HOLLOWED entry is where they diverged: a known field dropped field-wise while the entry
   * stays under EMAIL_TEMPLATE_MAX_ENTRY_BYTES. Editing a DIFFERENT field of that entry dropped the
   * stored `html` under the atom rule — the #956 defect one level deeper, on a field the admin
   * never touched. The per-field rule keeps it, which is why `patchEmailGroup` is now a wrapper.
   *
   * Kill-shot: restore the atom rule (`out[id] = entry` keyed on subject/html/text) and this fails
   * while every other test in this file still passes — which is exactly how it went unnoticed.
   */
  it('an over-cap template body survives an edit to a DIFFERENT field of the same entry', () => {
    const huge = 'x'.repeat(EMAIL_TEMPLATE_MAX_BODY + 1)
    const raw = {
      email: { templates: { 'password-reset': { html: huge } } }
    }
    const published = loaded(raw)
    // Hollowed, NOT dropped: the entry survives salvage, its over-cap field does not.
    expect(published.templates['password-reset']).toEqual({})
    const out = patchEmailGroup(
      raw.email,
      published,
      withField(published, {
        templates: {
          ...published.templates,
          'password-reset': {
            ...published.templates['password-reset'],
            subject: 'New'
          }
        }
      })
    )
    expect(out.templates).toEqual({
      'password-reset': { html: huge, subject: 'New' }
    })
  })

  it('an over-cap template ENTRY survives a from-address-only save', () => {
    // Over EMAIL_TEMPLATE_MAX_ENTRY_BYTES via an unknown passthrough field — the #935 shape,
    // and the only way to exceed the ENTRY cap given the per-field caps. The `toBeUndefined`
    // below is what keeps this honest if that cap ever moves.
    const entry = { html: 'ok', futureField: 'x'.repeat(300_000) }
    const raw = {
      email: { fromAddress: 'a@b.co', templates: { 'password-reset': entry } }
    }
    const published = loaded(raw)
    expect(published.templates['password-reset']).toBeUndefined() // dropped whole
    const out = patchEmailGroup(
      raw.email,
      published,
      withField(published, { fromAddress: 'c@d.co' })
    )
    expect(out.templates).toEqual({ 'password-reset': entry })
  })

  // Review F2: the boundary of the per-ENTRY rule, pinned rather than asserted in prose. An
  // entry salvage let THROUGH round-trips its unknown fields; an entry salvage REJECTED whole is
  // absent from `next`, so customizing that id writes the editor's entry over the stored one and
  // the unknown fields go with it. Correct — the admin edited that entry — but not obvious, and
  // the comment on `entryKey` used to claim the opposite.
  it('an unknown field inside an ACCEPTED entry round-trips through an edit of that entry', () => {
    const raw = {
      email: {
        templates: { 'password-reset': { subject: 'Old', futureField: 'keep' } }
      }
    }
    const published = loaded(raw)
    expect(published.templates['password-reset']).toMatchObject({
      futureField: 'keep'
    })
    const out = patchEmailGroup(
      raw.email,
      published,
      withField(published, {
        templates: {
          ...published.templates,
          'password-reset': {
            ...published.templates['password-reset'],
            subject: 'New'
          }
        }
      })
    )
    expect(out.templates).toEqual({
      'password-reset': { subject: 'New', futureField: 'keep' }
    })
  })

  it('customizing an id whose stored entry salvage rejected replaces the stored entry, unknown fields included', () => {
    const raw = {
      email: {
        templates: {
          'password-reset': { html: 'ok', futureField: 'x'.repeat(300_000) }
        }
      }
    }
    const published = loaded(raw)
    expect(published.templates['password-reset']).toBeUndefined() // over the entry cap
    const out = patchEmailGroup(
      raw.email,
      published,
      withField(published, {
        templates: { 'password-reset': { subject: 'Mine' } }
      })
    )
    expect(out.templates).toEqual({ 'password-reset': { subject: 'Mine' } })
  })

  it('unknown keys inside the email group survive (the #885 Finding 4 promise)', () => {
    const raw = { email: { fromAddress: 'a@b.co', futureKey: { x: 1 } } }
    const published = loaded(raw)
    const out = patchEmailGroup(
      raw.email,
      published,
      withField(published, { fromAddress: 'c@d.co' })
    )
    expect(out.futureKey).toEqual({ x: 1 })
  })

  it('a non-object stored email group is replaced by the patch alone, never spread', () => {
    const published = loaded({ email: 42 })
    const out = patchEmailGroup(
      42,
      published,
      withField(published, { fromAddress: 'c@d.co' })
    )
    expect(out).toEqual({ fromAddress: 'c@d.co' })
  })

  it('a non-object stored templates value is replaced only when templates changed', () => {
    const raw = { email: { fromAddress: 'a@b.co', templates: 7 } }
    const published = loaded(raw)
    // From-address only: the junk is left exactly as stored — this function never "tidies".
    expect(
      patchEmailGroup(
        raw.email,
        published,
        withField(published, { fromAddress: 'c@d.co' })
      ).templates
    ).toBe(7)
    // Templates changed: the junk is replaced by the real map.
    expect(
      patchEmailGroup(
        raw.email,
        published,
        withField(published, {
          templates: { 'password-reset': { subject: 'S' } }
        })
      ).templates
    ).toEqual({ 'password-reset': { subject: 'S' } })
  })

  it('writes nothing at all when nothing changed', () => {
    const raw = { email: { fromAddress: 'a@b.co', provider: 'sendgrid' } }
    const published = loaded(raw)
    expect(patchEmailGroup(raw.email, published, published)).toEqual(raw.email)
  })
})
