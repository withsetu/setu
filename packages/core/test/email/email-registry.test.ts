import { describe, expect, it } from 'vitest'
import {
  EMAIL_TYPE_FORM_NOTIFICATION,
  EMAIL_TYPE_PASSWORD_RESET,
  EMAIL_RENDERED_MAX_BODY,
  EMAIL_TEMPLATE_MAX_BODY,
  EMAIL_TEMPLATE_MAX_SUBJECT,
  createEmailTypeRegistry,
  renderEmailTemplate,
  renderRegisteredEmail,
  renderTemplateField,
  type EmailTypeDefinition,
  type RenderedEmail
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

// #920. isUsableTemplateField only ever sees the template STRING. A string can be well-formed,
// non-empty and within cap and still render to NOTHING, because unknown tokens are stripped and
// the grammar is case-sensitive — which is how `{{Reset_Url}}` shipped password-reset emails with
// a blank subject line. The floor is at RENDER time deliberately: settings.json is Git-canonical,
// so a bad override can arrive by `git push` without ever passing the editor.
describe('the render-time floor', () => {
  const values = passwordResetValues({ url: 'https://x/reset' })

  // KILL-SHOT TARGET. Make renderTemplateField `return out` instead of reporting null for a blank
  // render (the pre-#920 behavior) and this fails with subject === ''.
  it('a subject whose only token is a typo renders the shipped subject, not a blank one', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { subject: '{{Reset_Url}}' },
      values
    )
    expect(out.subject).toBe('Reset your Setu password')
  })

  // The shapes that strip to nothing are the ones the grammar MATCHES (`\w+`) but cannot resolve.
  // A near-miss like `{{reset-url}}` is not one of them: a hyphen never matches, so it survives as
  // literal braces — non-blank, so this floor deliberately lets it through. Tracked as #924.
  it('a subject of nothing but an unknown token falls back', () => {
    expect(
      renderEmailTemplate(PASSWORD_RESET_EMAIL, { subject: '{{nope}}' }, values)
        .subject
    ).toBe('Reset your Setu password')
  })

  // A token that IS in the vocabulary but has no value renders as nothing too, so the floor
  // cannot be a token-name check — it has to look at the rendered bytes.
  it('a subject of a known token with no value falls back', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { subject: '{{user_name}}' },
      passwordResetValues({ url: 'https://x/reset' })
    )
    expect(out.subject).toBe('Reset your Setu password')
  })

  it('a subject that survives the render is still the admin’s', () => {
    expect(
      renderEmailTemplate(
        PASSWORD_RESET_EMAIL,
        { subject: 'Reset · {{nope}}' },
        values
      ).subject
    ).toBe('Reset ·')
  })

  it('a body that renders to nothing falls back to the shipped body', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { html: '{{Reset_Url}}' },
      values
    )
    expect(out.html).toContain('We received a request')
  })

  // The html override did not survive, so the text part must not be DERIVED from it either —
  // deriving from an empty body would hand a text-only client an empty message.
  it('a body that renders to nothing takes the text part back to the shipped one', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { html: '{{Reset_Url}}' },
      values
    )
    expect(out.text).toContain('Reset your password: https://x/reset')
  })

  // Markup with no words in it renders non-empty as HTML but derives an empty text part.
  it('an overridden body whose text derivation is empty falls back to the shipped text', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { html: '<img src="{{reset_url}}" alt="">' },
      values
    )
    expect(out.html).toBe('<img src="https://x/reset" alt="">')
    expect(out.text).toContain('Reset your password: https://x/reset')
  })

  it('a text override that renders to nothing falls back rather than sending a blank part', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { text: '{{Reset_Url}}' },
      values
    )
    expect(out.text).toContain('Reset your password: https://x/reset')
  })

  it('the floor is per FIELD — a dead subject does not cost a good body', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { subject: '{{Reset_Url}}', html: '<p>Custom {{reset_url}}</p>' },
      values
    )
    expect(out.subject).toBe('Reset your Setu password')
    expect(out.html).toBe('<p>Custom https://x/reset</p>')
  })

  // renderTemplateField is the seam the admin editor calls to refuse a Save (#920's
  // authoring-time half). Same function the renderer uses, so the editor's answer cannot drift.
  it('renderTemplateField reports a dead field as null and a live one verbatim', () => {
    expect(
      renderTemplateField(
        PASSWORD_RESET_EMAIL,
        'subject',
        '{{Reset_Url}}',
        values
      )
    ).toBeNull()
    expect(
      renderTemplateField(
        PASSWORD_RESET_EMAIL,
        'subject',
        ' \n {{nope}} ',
        values
      )
    ).toBeNull()
    expect(
      renderTemplateField(
        PASSWORD_RESET_EMAIL,
        'subject',
        'Reset {{user_name}}',
        { ...values, user_name: 'Ada' }
      )
    ).toBe('Reset Ada')
  })
})

describe('text part', () => {
  const values = passwordResetValues({ url: 'https://x/reset' })

  it('uses the shipped default text when the html was not overridden', () => {
    const out = renderEmailTemplate(PASSWORD_RESET_EMAIL, {}, values)
    expect(out.text).toContain('Reset your password: https://x/reset')
    expect(out.textSource).toBe('shipped')
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
    expect(out.textSource).toBe('derived')
  })

  // `textSource` is what the editor's help text reads (#920 review F2), so the arm it reports
  // has to be right for the third case too — not just for "overridden" vs "not".
  it('reports the shipped arm when an overridden body derives nothing', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { html: '<img src="{{reset_url}}" alt="">' },
      values
    )
    expect(out.html).toBe('<img src="https://x/reset" alt="">')
    expect(out.textSource).toBe('shipped')
  })

  it('an explicit text override wins over both', () => {
    const out = renderEmailTemplate(
      PASSWORD_RESET_EMAIL,
      { html: '<p>ignored</p>', text: 'Go to {{reset_url}}' },
      values
    )
    expect(out.textSource).toBe('stored')
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

  // #935. `EMAIL_TEMPLATE_MAX_SUBJECT` capped the stored TEMPLATE; the RENDERED subject was
  // uncapped, and `New submission: {{form_label}}` fills that token from an unauthenticated
  // request body. Two consequences: after a 16-character prefix an anonymous submitter dictated
  // the Subject of a message the operator's client shows as coming from the site's own
  // from-address, and a ~1 MiB label produced a ~1 MiB Subject header, which RFC 5322 (998 octets
  // per line) makes relays reject — losing the notification entirely, since submission-service.ts
  // swallows the send failure into console.error.
  //
  // The cap lives in renderEmailTemplate, not at a call site, because the admin's live preview
  // and the server's send BOTH go through it (see the preview-parity note in
  // template-registry.ts); capping one side would break that parity.
  describe('the rendered subject is capped (#935)', () => {
    // KILL-SHOT TARGET. Remove capSubject in template-registry.ts and this reports 1_000_016.
    it('caps a subject the shipped template built from a visitor-supplied label', () => {
      const out = renderEmailTemplate(
        FORM_NOTIFICATION_EMAIL,
        {},
        formNotificationValues({
          id: 's1',
          formId: 'contact',
          formLabel: 'x'.repeat(1_000_000),
          fields: {},
          createdAt: 0
        })
      )
      expect(out.subject.length).toBeLessThanOrEqual(EMAIL_TEMPLATE_MAX_SUBJECT)
      expect(out.subject.startsWith('New submission: xxx')).toBe(true)
      // Visibly truncated: the operator can tell the subject was cut, not just written oddly.
      expect(out.subject.endsWith('…')).toBe(true)
    })

    // The override arm renders a template that is itself within cap, so only the VALUE can push
    // the result over — the case the template-side cap structurally cannot see.
    it('caps a subject an admin override built from a visitor-supplied value', () => {
      const out = renderEmailTemplate(
        FORM_NOTIFICATION_EMAIL,
        { subject: 'Re: {{form_label}}' },
        formNotificationValues({
          id: 's1',
          formId: 'contact',
          formLabel: 'y'.repeat(50_000),
          fields: {},
          createdAt: 0
        })
      )
      expect(out.subject.length).toBeLessThanOrEqual(EMAIL_TEMPLATE_MAX_SUBJECT)
      expect(out.subject.startsWith('Re: yyy')).toBe(true)
    })

    // KILL-SHOT TARGET for the surrogate guard. A plain `slice` cuts UTF-16 code units, so a cap
    // landing between a surrogate pair leaves a LONE surrogate in a mail header. The emoji is two
    // code units, so putting one at the boundary forces the split.
    it('never cuts an astral character in half', () => {
      const out = renderEmailTemplate(
        FORM_NOTIFICATION_EMAIL,
        {},
        formNotificationValues({
          id: 's1',
          formId: 'contact',
          // 'New submission: ' is 16 chars, so the pairs straddle the 299-char boundary.
          formLabel: '😀'.repeat(1_000),
          fields: {},
          createdAt: 0
        })
      )
      expect(out.subject.length).toBeLessThanOrEqual(EMAIL_TEMPLATE_MAX_SUBJECT)
      // No unpaired surrogate survives — a high one with no low after it, or a low one with no
      // high before it. These two regexes are the WHOLE assertion. An earlier version also spread
      // the string and checked `codePointAt(0) !== undefined`, which is true of a lone surrogate
      // too and so proved nothing: a vacuous assertion sitting in a security test is the #638
      // class, worse than no assertion because it reads as coverage.
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out.subject)).toBe(false)
      expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out.subject)).toBe(
        false
      )
    })

    it('leaves a subject at exactly the cap untouched', () => {
      const exact = 'z'.repeat(EMAIL_TEMPLATE_MAX_SUBJECT)
      const out = renderEmailTemplate(
        PASSWORD_RESET_EMAIL,
        { subject: exact },
        passwordResetValues({ url: 'https://x/reset' })
      )
      expect(out.subject).toBe(exact)
    })
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

/**
 * What the editor's preview shows, frozen to the byte (#922).
 *
 * This block used to be called "preview parity" and compared `renderEmailTemplate(def, {},
 * def.sampleValues)` to ITSELF — the same pure function over the same module-level constants, an
 * assertion no mutation of the product could ever fail (the #638 vacuous-assertion class). It
 * also could not have checked parity even in principle: parity is "the admin's preview IS the
 * server's render", and that is a claim about the EDITOR, enforced in
 * apps/admin/test/email-templates.test.tsx ("renders the preview with core's renderEmailTemplate
 * over the type's sampleValues").
 *
 * What this file can pin, and now does, is the other half: the exact bytes the preview shows for
 * every shipped type. Frozen literals, so a change anywhere in the pipeline — a default
 * template, the escaping policy, the strip-unknown rule, the sample values, the new #920 floor —
 * has to be re-typed here deliberately instead of sliding through.
 */
describe('the shipped defaults’ rendered preview', () => {
  const RESET_URL =
    'https://api.example.com/api/auth/reset-password/EXAMPLE-TOKEN?callbackURL=%2Freset-password'

  const EXPECTED: Record<string, RenderedEmail> = {
    'password-reset': {
      subject: 'Reset your Setu password',
      html: `<p>We received a request to reset the password for your Setu account.</p>
<p><a href="${RESET_URL}">Reset your password</a></p>
<p>This link will expire soon. If you didn't request this, you can safely ignore this email.</p>`,
      text: `We received a request to reset the password for your Setu account.

Reset your password: ${RESET_URL}

This link will expire soon. If you didn't request this, you can safely ignore this email.`,
      // No override at all, so the hand-written defaultText is what a text-only client gets.
      textSource: 'shipped',
      htmlSource: 'shipped'
    },
    'form-notification': {
      subject: 'New submission: Contact',
      html: `<h2 style="font-family:system-ui,sans-serif;font-size:20px;margin:0 0 16px">New submission: Contact</h2>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:system-ui,sans-serif;font-size:14px;border-collapse:collapse">
<tr><td style="padding:4px 16px 4px 0;color:#71717a;vertical-align:top;white-space:nowrap">name</td><td style="padding:4px 0;white-space:pre-wrap">Ada Lovelace</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#71717a;vertical-align:top;white-space:nowrap">email</td><td style="padding:4px 0;white-space:pre-wrap">ada@example.com</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#71717a;vertical-align:top;white-space:nowrap">message</td><td style="padding:4px 0;white-space:pre-wrap">Hello — I’d like to know more about your work.</td></tr>
</table>
<p style="font-family:system-ui,sans-serif;font-size:12px;color:#71717a;margin:16px 0 0">Submitted 2026-01-15 09:41 UTC · form contact</p>`,
      text: `New submission on "Contact"

name: Ada Lovelace
email: ada@example.com
message: Hello — I’d like to know more about your work.

Submitted 2026-01-15 09:41 UTC · form contact`,
      textSource: 'shipped',
      htmlSource: 'shipped'
    }
  }

  // Without this, adding a type would silently escape the pin above — the loop below only checks
  // the types that happen to have an entry.
  it('every registered type has a frozen expectation', () => {
    expect(EMAIL_TYPES.list().map((t) => t.id)).toEqual(Object.keys(EXPECTED))
  })

  it('renders each type’s sampleValues to exactly the frozen bytes', () => {
    for (const def of EMAIL_TYPES.list())
      expect(renderEmailTemplate(def, {}, def.sampleValues)).toEqual(
        EXPECTED[def.id]
      )
  })

  // The preview is what an admin judges their template by, so a token that did not resolve must
  // never reach it looking like literal text.
  it('a sample preview contains no unresolved token braces', () => {
    for (const def of EMAIL_TYPES.list()) {
      const out = renderEmailTemplate(def, {}, def.sampleValues)
      expect(out.html).not.toMatch(/\{\{/)
      expect(out.subject).not.toMatch(/\{\{/)
      expect(out.text).not.toMatch(/\{\{/)
    }
  })
})

/**
 * #950 — the RENDERED body is bounded, not just the inputs.
 *
 * `formNotificationValues` HTML-escapes every submitted field name and value, which is the only
 * thing standing between an anonymous submitter and the operator's mail client — and escaping is
 * EXPANSIVE: one `&` in the request buys five characters (`&amp;`) in the render. So a request can
 * satisfy every cap at the forms boundary simultaneously and still render megabytes. Measured on
 * the parent commit, at exactly the #935 caps (100 fields, 200-character names, 10,000-character
 * values, all `&`): a 1,020,865-byte request body rendered 5,035,997 characters of HTML and
 * 1,020,568 of text — 4.93x amplification.
 *
 * The bound lives in `renderEmailTemplate`, exactly like `capSubject`, and for the same reason: the
 * admin's live preview and the server's send are the same function (the preview-parity note at the
 * top of template-registry.ts), so a cap on one side only would make the preview a lie — and that
 * parity is load-bearing for epic #497. Tightening the #935 input caps instead was the issue's
 * option 2; it was NOT taken, because it only moves the ceiling (the render is still whatever the
 * new caps multiply out to) and it would refuse a submission a visitor actually typed.
 */
describe('the rendered body is capped (#950)', () => {
  /** A submission sitting at every #935 cap at once, using the maximally-expansive character. */
  const atEveryCap = () => {
    const fields: Record<string, string> = {}
    for (let i = 0; i < 100; i++)
      fields[`${'n'.repeat(197)}${String(i).padStart(3, '0')}`] = '&'.repeat(
        10_000
      )
    return formNotificationValues({
      id: 's1',
      formId: 'contact',
      formLabel: 'L'.repeat(200),
      fields,
      createdAt: 0
    })
  }

  // KILL-SHOT TARGET. Remove capBody in template-registry.ts and this reports 5,035,997 / 1,020,568.
  it('bounds both parts of a notification built at every input cap simultaneously', () => {
    const out = renderEmailTemplate(FORM_NOTIFICATION_EMAIL, {}, atEveryCap())
    expect(out.html.length).toBeLessThanOrEqual(EMAIL_RENDERED_MAX_BODY)
    expect(out.text.length).toBeLessThanOrEqual(EMAIL_RENDERED_MAX_BODY)
  })

  // The honesty rule capSubject follows: an operator seeing a short email must be able to tell it
  // was cut rather than that the visitor sent little. A silent trim would lose rows invisibly.
  it('says so, visibly, in both parts, and names the size that overflowed', () => {
    const out = renderEmailTemplate(FORM_NOTIFICATION_EMAIL, {}, atEveryCap())
    for (const part of [out.html, out.text]) {
      expect(part).toContain('trimmed')
      expect(part).toContain(String(EMAIL_RENDERED_MAX_BODY))
    }
    // Each part names ITS OWN pre-trim size, so the operator sees the real scale of what arrived —
    // and the two differ by ~5x, which is the escape amplification this issue is about.
    expect(out.html).toContain('5035997')
    expect(out.text).toContain('1020568')
  })

  // The bound must not cost a REAL notification. A single field at the 10,000-character value cap
  // renders 50,565 characters of HTML — the largest a legitimate at-cap submission produces — so
  // the ceiling sits above it deliberately.
  it('leaves a single maximal field alone — no trim, no notice', () => {
    const out = renderEmailTemplate(
      FORM_NOTIFICATION_EMAIL,
      {},
      formNotificationValues({
        id: 's1',
        formId: 'contact',
        fields: { message: '&'.repeat(10_000) },
        createdAt: 0
      })
    )
    expect(out.html.length).toBe(50_565)
    expect(out.html.length).toBeLessThan(EMAIL_RENDERED_MAX_BODY)
    expect(out.html).not.toContain('trimmed')
    expect(out.text).not.toContain('trimmed')
  })

  // The cap is INCLUSIVE. Reaching it exactly needs a token VALUE, not a long template: the
  // template-string cap (EMAIL_TEMPLATE_MAX_BODY, 20,000) is three times smaller than the rendered
  // one, so a stored override can never get there by itself — which is precisely the gap #950
  // closes. The row markup is fixed-width, so one measurement gives the exact value length needed.
  it('leaves a body at exactly the cap untouched', () => {
    const render = (n: number) =>
      renderEmailTemplate(
        FORM_NOTIFICATION_EMAIL,
        { html: '{{fields}}' },
        formNotificationValues({
          id: 's1',
          formId: 'c',
          fields: { m: 'a'.repeat(n) },
          createdAt: 0
        })
      )
    const overhead = render(1).html.length - 1
    const out = render(EMAIL_RENDERED_MAX_BODY - overhead)
    expect(out.html.length).toBe(EMAIL_RENDERED_MAX_BODY)
    expect(out.html).not.toContain('trimmed')
    // One character more and it IS trimmed, which is what makes the assertion above about the
    // boundary rather than about the body simply being small.
    const over = render(EMAIL_RENDERED_MAX_BODY - overhead + 1)
    expect(over.html.length).toBeLessThanOrEqual(EMAIL_RENDERED_MAX_BODY)
    expect(over.html).toContain('trimmed')
  })

  // The arm the forms boundary structurally cannot reach: settings.json is Git-canonical, so an
  // override can arrive by `git push` without passing the api's settings-write gate. One that
  // repeats `{{fields}}` re-amplifies a within-cap submission.
  it('bounds an override that repeats the {{fields}} block', () => {
    const out = renderEmailTemplate(
      FORM_NOTIFICATION_EMAIL,
      { html: '{{fields}}'.repeat(1_000) },
      formNotificationValues({
        id: 's1',
        formId: 'contact',
        fields: { message: '&'.repeat(1_000) },
        createdAt: 0
      })
    )
    expect(out.html.length).toBeLessThanOrEqual(EMAIL_RENDERED_MAX_BODY)
    // The text part is DERIVED from an overridden body, so it inherits the same ceiling rather
    // than being re-derived from the untrimmed render.
    expect(out.textSource).toBe('derived')
    expect(out.text.length).toBeLessThanOrEqual(EMAIL_RENDERED_MAX_BODY)
  })

  // KILL-SHOT TARGET for the markup-boundary backoff. A hard slice can land inside one of OUR tags
  // or inside a character reference (submitter content is escaped BEFORE the cut, so a cut can
  // never manufacture a tag out of submitted text) — and an unterminated `<td style="…` would
  // swallow the trim notice appended after it into an attribute, so the operator would be told
  // nothing at all.
  //
  // Two things this test learned the hard way, both from kill-shots that failed to fail:
  //  - it must be a SWEEP. With many rows the cut lands on a newline boundary and the backoff never
  //    runs, so any single many-row case stays green with the backoff deleted. One enormous row has
  //    no newline at all, and sliding the field-name length walks the cut position through the
  //    row's own markup and through the `&amp;` references in its value.
  //  - the invariant must be checked STRUCTURALLY, not at the end of the string. `endsWith('</p>')`
  //    and `lastIndexOf('<') < lastIndexOf('>')` are both true of a dangling tag once the notice
  //    has been appended after it, which is exactly how the first version of this test passed
  //    against deliberately-broken code.
  it('never leaves a half-written tag or character reference', () => {
    // `<` … `<` with no `>` between them is an unterminated tag, wherever it sits.
    const UNTERMINATED_TAG = /<[^<>]*</
    // Every `&` in this output comes from escapeHtml, so it is always a complete reference unless
    // the cut split one.
    const TRUNCATED_ENTITY = /&(?![a-zA-Z#][a-zA-Z0-9]{0,8};)/
    let trimmed = 0
    for (let name = 63_500; name <= 63_850; name++) {
      const out = renderEmailTemplate(
        FORM_NOTIFICATION_EMAIL,
        { html: '{{fields}}' },
        formNotificationValues({
          id: 's1',
          formId: 'c',
          fields: { ['n'.repeat(name)]: '&'.repeat(600) },
          createdAt: 0
        })
      )
      const at = `name=${name}`
      expect(out.html.length, at).toBeLessThanOrEqual(EMAIL_RENDERED_MAX_BODY)
      expect(UNTERMINATED_TAG.test(out.html), at).toBe(false)
      expect(TRUNCATED_ENTITY.test(out.html), at).toBe(false)
      expect(out.html, at).toContain('trimmed here')
      trimmed++
    }
    // Every case in the sweep really was over the cap — otherwise the loop would be asserting
    // invariants about untrimmed output and proving nothing.
    expect(trimmed).toBe(351)
  })

  // KILL-SHOT TARGET for deriving the text part from the CAPPED html. Length alone cannot catch
  // this — capBody clamps the text part afterwards either way — so what discriminates is WHICH
  // bytes the two halves describe: derived from the capped html, the text part carries the html
  // part's own notice and needs no second trim of its own. Derived from the untrimmed render it
  // would be trimmed independently, naming a different size, and the two halves of one email would
  // describe different content.
  it('derives the text part from the capped html, so the two halves agree', () => {
    const out = renderEmailTemplate(
      FORM_NOTIFICATION_EMAIL,
      { html: '{{fields}}'.repeat(1_000) },
      formNotificationValues({
        id: 's1',
        formId: 'contact',
        fields: { message: '&'.repeat(1_000) },
        createdAt: 0
      })
    )
    expect(out.textSource).toBe('derived')
    const size = /rendered (\d+) characters/.exec(out.html)?.[1]
    expect(size).toBeDefined()
    expect(out.text).toContain(`rendered ${size!} characters`)
    // Exactly one trim happened, and it is the html one the text inherited.
    expect(out.text.match(/trimmed here/g)).toHaveLength(1)
  })

  // Same reasoning as capSubject's surrogate guard: `slice` works in UTF-16 code units, so a cut
  // between a surrogate pair leaves a LONE surrogate, which is an unencodable code unit rather
  // than "the email is long". The emoji is two units, so filling the body with them forces a
  // boundary hit.
  it('never cuts an astral character in half', () => {
    const out = renderEmailTemplate(
      FORM_NOTIFICATION_EMAIL,
      {},
      formNotificationValues({
        id: 's1',
        formId: 'contact',
        fields: { message: '😀'.repeat(60_000) },
        createdAt: 0
      })
    )
    for (const part of [out.html, out.text]) {
      expect(part.length).toBeLessThanOrEqual(EMAIL_RENDERED_MAX_BODY)
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(part)).toBe(false)
      expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(part)).toBe(false)
    }
  })
})
