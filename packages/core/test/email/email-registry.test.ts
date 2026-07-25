import { describe, expect, it } from 'vitest'
import {
  EMAIL_TYPE_FORM_NOTIFICATION,
  EMAIL_TYPE_PASSWORD_RESET,
  EMAIL_TEMPLATE_MAX_BODY,
  EMAIL_TEMPLATE_MAX_SUBJECT,
  createEmailTypeRegistry,
  renderEmailTemplate,
  renderRegisteredEmail,
  type EmailTypeDefinition
} from '../../src/email/template-registry'
import { EMAIL_TYPES } from '../../src/email/templates'
import {
  PASSWORD_RESET_EMAIL,
  passwordResetValues
} from '../../src/email/templates/password-reset'
import {
  FORM_NOTIFICATION_EMAIL,
  formNotificationValues
} from '../../src/email/templates/form-notification'

// #499 (epic #497): the email TYPE registry — named types carrying their token vocabulary and
// the shipped default template, plus the per-send resolution that makes an admin override in
// settings.json win while a malformed one falls back safely.

const resetDef = EMAIL_TYPES.get(EMAIL_TYPE_PASSWORD_RESET)
const notifyDef = EMAIL_TYPES.get(EMAIL_TYPE_FORM_NOTIFICATION)

describe('registry', () => {
  it('registers the two core types with their metadata', () => {
    expect(EMAIL_TYPES.list().map((t) => t.id)).toEqual([
      'password-reset',
      'form-notification'
    ])
    expect(resetDef?.label).toBe('Password reset')
    expect(notifyDef?.label).toBe('Form notification')
  })

  it('returns undefined for an unregistered id', () => {
    expect(EMAIL_TYPES.get('nope')).toBeUndefined()
  })

  // The plugin surface (#302): a plugin registers a type through the same public `register`
  // core uses for its own two, touching no core internals.
  it('accepts a third-party type through the public register()', () => {
    const reg = createEmailTypeRegistry()
    const custom: EmailTypeDefinition = {
      id: 'welcome',
      label: 'Welcome',
      description: 'Sent to a new user.',
      tokens: [{ name: 'who', description: 'Their name' }],
      defaultSubject: 'Welcome {{who}}',
      defaultHtml: '<p>Hi {{who}}</p>',
      defaultText: 'Hi {{who}}',
      sampleValues: { who: 'Ada' }
    }
    reg.register(custom)
    expect(reg.get('welcome')).toBe(custom)
    expect(reg.list()).toEqual([custom])
  })

  it('refuses a duplicate id rather than silently shadowing', () => {
    const reg = createEmailTypeRegistry()
    reg.register(PASSWORD_RESET_EMAIL)
    expect(() => reg.register(PASSWORD_RESET_EMAIL)).toThrow(/already/i)
  })

  // renderRegisteredEmail is the one seam every send path goes through, so "which override
  // applies" is answered in exactly one place.
  it('renderRegisteredEmail applies the override stored under the type id', () => {
    const out = renderRegisteredEmail(
      EMAIL_TYPES,
      EMAIL_TYPE_PASSWORD_RESET,
      {
        'password-reset': { subject: 'Mine' },
        'form-notification': { subject: 'Theirs' }
      },
      passwordResetValues({ url: 'https://x/reset' })
    )
    expect(out.subject).toBe('Mine')
  })

  it('renderRegisteredEmail throws on an unknown type rather than sending the wrong email', () => {
    expect(() => renderRegisteredEmail(EMAIL_TYPES, 'nope', {}, {})).toThrow(
      /unknown email type/i
    )
  })

  it('every token a shipped default template uses is in that type’s vocabulary', () => {
    for (const def of EMAIL_TYPES.list()) {
      const names = new Set(def.tokens.map((t) => t.name))
      const used = [def.defaultSubject, def.defaultHtml, def.defaultText]
        .join(' ')
        .matchAll(/\{\{\s*(\w+)\s*\}\}/g)
      for (const m of used) expect(names).toContain(m[1])
    }
  })

  it('every type’s sampleValues covers its whole vocabulary', () => {
    for (const def of EMAIL_TYPES.list())
      for (const t of def.tokens)
        expect(def.sampleValues[t.name], `${def.id}.${t.name}`).toBeDefined()
  })
})

describe('shipped defaults are byte-identical to the pre-#499 output', () => {
  // The literals below are copied verbatim from packages/auth/src/reset-password-email.ts as
  // it stood before #499. Their point is that turning the hardcoded string into a registry
  // default changed NOTHING an existing recipient sees — an admin who never opens the editor
  // gets the same email, to the byte. Kill-shot: change one character of
  // PASSWORD_RESET_EMAIL.defaultHtml and this fails.
  const url =
    'https://api.example.com/api/auth/reset-password/tok?callbackURL=%2Fx'

  it('password-reset renders the exact former subject/html/text', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      {},
      passwordResetValues({ url })
    )
    expect(out.subject).toBe('Reset your Setu password')
    expect(out.html)
      .toBe(`<p>We received a request to reset the password for your Setu account.</p>
<p><a href="${url}">Reset your password</a></p>
<p>This link will expire soon. If you didn't request this, you can safely ignore this email.</p>`)
    expect(out.text)
      .toBe(`We received a request to reset the password for your Setu account.

Reset your password: ${url}

This link will expire soon. If you didn't request this, you can safely ignore this email.`)
  })

  it('form-notification keeps the former subject line exactly', () => {
    const out = renderEmailTemplate(
      FORM_NOTIFICATION_EMAIL,
      {},
      formNotificationValues({
        id: 's1',
        formId: 'contact',
        formLabel: 'Contact',
        fields: { name: 'Ada' },
        createdAt: 0
      })
    )
    expect(out.subject).toBe('New submission: Contact')
  })

  it('form-notification falls back to the form id when there is no label', () => {
    const out = renderEmailTemplate(
      FORM_NOTIFICATION_EMAIL,
      {},
      formNotificationValues({
        id: 's1',
        formId: 'contact',
        fields: {},
        createdAt: 0
      })
    )
    expect(out.subject).toBe('New submission: contact')
  })
})

describe('override resolution', () => {
  const values = passwordResetValues({ url: 'https://x/reset' })

  it('an override wins over the default', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { subject: 'Your {{site_title}} password', html: '<p>{{reset_url}}</p>' },
      { ...values, site_title: 'My Site' }
    )
    expect(out.subject).toBe('Your My Site password')
    expect(out.html).toBe('<p>https://x/reset</p>')
  })

  it('an absent override uses the shipped default', () => {
    expect(
      renderEmailTemplate(PASSWORD_RESET_EMAIL, undefined, values).subject
    ).toBe(PASSWORD_RESET_EMAIL.defaultSubject)
  })

  // The DoD line: a broken override must never send garbage. Empty, whitespace-only,
  // wrong-typed and oversized all fall back to the shipped default, FIELD BY FIELD — a bad
  // subject does not cost you a good body.
  it('an empty or whitespace-only field falls back to the default', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { subject: '', html: '   \n  ' },
      values
    )
    expect(out.subject).toBe('Reset your Setu password')
    expect(out.html).toContain('We received a request')
  })

  it('an oversized body falls back to the default', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { html: 'x'.repeat(EMAIL_TEMPLATE_MAX_BODY + 1) },
      values
    )
    expect(out.html).toContain('We received a request')
  })

  it('an oversized subject falls back to the default', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { subject: 'x'.repeat(EMAIL_TEMPLATE_MAX_SUBJECT + 1) },
      values
    )
    expect(out.subject).toBe('Reset your Setu password')
  })

  it('a non-string field falls back to the default', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { subject: 42 as unknown as string },
      values
    )
    expect(out.subject).toBe('Reset your Setu password')
  })

  it('one bad field does not take the good ones with it', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { subject: '', html: '<p>Custom {{reset_url}}</p>' },
      values
    )
    expect(out.subject).toBe('Reset your Setu password')
    expect(out.html).toBe('<p>Custom https://x/reset</p>')
  })
})

describe('text part', () => {
  const values = passwordResetValues({ url: 'https://x/reset' })

  it('uses the shipped default text when the html was not overridden', () => {
    expect(
      renderEmailTemplate(PASSWORD_RESET_EMAIL, {}, values).text
    ).toContain('Reset your password: https://x/reset')
  })

  // Without this the multipart message would pair a CUSTOMIZED html part with the SHIPPED text
  // part, so a text-only client would show wording the admin thought they had replaced.
  it('derives the text part from an overridden html body', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { html: '<p>Hello there</p><p><a href="{{reset_url}}">Reset</a></p>' },
      values
    )
    expect(out.text).toBe('Hello there\n\nReset (https://x/reset)')
  })

  it('an explicit text override wins over both', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { html: '<p>ignored</p>', text: 'Go to {{reset_url}}' },
      values
    )
    expect(out.text).toBe('Go to https://x/reset')
  })
})

describe('security', () => {
  it('escapes a token value containing markup in the html part', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { html: '<p>Hi {{user_name}}</p>' },
      passwordResetValues({
        url: 'https://x/reset',
        userName: '<script>alert(1)</script>'
      })
    )
    expect(out.html).toBe('<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(out.html).not.toContain('<script>')
  })

  // KILL-SHOT TARGET. A form submitter is an anonymous stranger; their field values land in an
  // email an admin reads. Remove the escaping inside formNotificationValues' row builder and
  // this fails.
  it('escapes submitter-supplied field names and values inside the {{fields}} block', () => {
    const out = renderEmailTemplate(
      FORM_NOTIFICATION_EMAIL,
      {},
      formNotificationValues({
        id: 's1',
        formId: 'contact',
        fields: {
          '<b>k</b>': '<script>alert(1)</script>',
          quote: 'a "b" \'c\' & d'
        },
        createdAt: 0
      })
    )
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out.html).toContain('&lt;b&gt;k&lt;/b&gt;')
    expect(out.html).toContain('&quot;b&quot;')
    expect(out.html).toContain('&amp; d')
  })

  it('escapes a submitter-supplied form label in the subject’s host document', () => {
    const out = renderEmailTemplate(
      FORM_NOTIFICATION_EMAIL,
      {},
      formNotificationValues({
        id: 's1',
        formId: 'contact',
        formLabel: '<img src=x onerror=alert(1)>',
        fields: {},
        createdAt: 0
      })
    )
    expect(out.html).not.toContain('<img')
    expect(out.html).toContain('&lt;img')
  })

  // KILL-SHOT TARGET (reset-URL integrity). The reset link is server-generated; a template can
  // only ASK for it by name. There is no syntax with which to supply or override its value —
  // widen the token grammar in fill-template.ts to accept `name=value` and this fails.
  it('a template cannot supply or override the reset url', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      {
        subject: 'x',
        html:
          '<a href="{{reset_url=https://evil.test/steal}}">a</a>' +
          '<a href="{{reset_url}}">b</a>'
      },
      passwordResetValues({ url: 'https://real.test/reset?token=abc' })
    )
    // The forged form is not a token at all — it stays inert text, and the real token still
    // resolves to the server's URL.
    expect(out.html).toContain('{{reset_url=https://evil.test/steal}}')
    expect(out.html).toContain('href="https://real.test/reset?token=abc"')
  })

  it('a subject override cannot inject a mail header', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { subject: 'Reset\r\nBcc: evil@test' },
      passwordResetValues({ url: 'https://x/reset' })
    )
    expect(out.subject).toBe('Reset Bcc: evil@test')
    expect(out.subject).not.toMatch(/[\r\n]/)
  })

  it('a token value cannot inject a mail header into the subject', () => {
    const out = renderEmailTemplate(
      FORM_NOTIFICATION_EMAIL,
      {},
      formNotificationValues({
        id: 's1',
        formId: 'contact',
        formLabel: 'Contact\r\nBcc: evil@test',
        fields: {},
        createdAt: 0
      })
    )
    expect(out.subject).not.toMatch(/[\r\n]/)
  })
})

describe('preview parity', () => {
  // The whole point of rendering the editor preview through THIS function: a preview that can
  // disagree with the sent mail is the defect epic #497 exists to remove. Same def, same
  // override, same values ⇒ same bytes, in the admin and on the server.
  it('sampleValues render deterministically for every type', () => {
    for (const def of EMAIL_TYPES.list()) {
      const a = renderEmailTemplate(def, {}, def.sampleValues)
      const b = renderEmailTemplate(def, {}, def.sampleValues)
      expect(a).toEqual(b)
      expect(a.subject.length).toBeGreaterThan(0)
      expect(a.html.length).toBeGreaterThan(0)
      expect(a.text.length).toBeGreaterThan(0)
    }
  })

  it('a sample preview contains no unresolved token braces', () => {
    for (const def of EMAIL_TYPES.list()) {
      const out = renderEmailTemplate(def, {}, def.sampleValues)
      expect(out.html).not.toMatch(/\{\{/)
      expect(out.subject).not.toMatch(/\{\{/)
      expect(out.text).not.toMatch(/\{\{/)
    }
  })
})
