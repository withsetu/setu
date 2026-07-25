import { describe, expect, it } from 'vitest'
import {
  fillTemplate,
  escapeHtml,
  htmlToPlainText,
  tokenNamesIn,
  unknownTokensIn,
  type TokenSpec
} from '../../src/templating/fill-template'

// #499 (epic #497): the ONE {{token}} engine. Promoted out of seo/resolve-seo.ts so email
// templates, SEO titles and every future templated string share one syntax, one escaping
// policy and one unknown-token rule.

const vocab: TokenSpec[] = [
  { name: 'name', description: 'The recipient name' },
  { name: 'link', description: 'A server-generated URL', rawHtml: true },
  { name: 'rows', description: 'Pre-rendered rows', rawHtml: true }
]

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})

describe('fillTemplate — substitution', () => {
  it('substitutes a known token', () => {
    expect(fillTemplate('Hi {{name}}!', { name: 'Ada' })).toBe('Hi Ada!')
  })

  it('tolerates inner whitespace in the token', () => {
    expect(fillTemplate('Hi {{  name  }}!', { name: 'Ada' })).toBe('Hi Ada!')
  })

  it('substitutes the same token everywhere it appears', () => {
    expect(fillTemplate('{{name}}/{{name}}', { name: 'x' })).toBe('x/x')
  })

  // The documented unknown-token rule: STRIP. Same behavior the promoted SEO helper always
  // had, so one rule covers every context — and a recipient never sees `{{oops}}` in their
  // inbox. The editor warns about unknown tokens at authoring time instead (unknownTokensIn).
  it('strips an unknown token rather than leaving it literal', () => {
    expect(fillTemplate('Hi {{nope}}!', { name: 'Ada' })).toBe('Hi !')
  })

  it('strips a known token whose value is absent or undefined', () => {
    expect(fillTemplate('[{{name}}]', {})).toBe('[]')
    expect(fillTemplate('[{{name}}]', { name: undefined })).toBe('[]')
  })

  // Only `{{word}}` is a token. Anything else — including an attempt to smuggle a VALUE into
  // the template — is not matched, which is the structural reason a template can never supply
  // its own reset URL (see email-registry.test.ts's reset-URL integrity test).
  it('leaves non-token braces alone', () => {
    expect(fillTemplate('{{reset_url=http://evil}}', {})).toBe(
      '{{reset_url=http://evil}}'
    )
    expect(fillTemplate('{{a-b}} {single} {{ }}', {})).toBe(
      '{{a-b}} {single} {{ }}'
    )
  })

  it('does not re-scan a substituted value for tokens', () => {
    expect(fillTemplate('{{name}}', { name: '{{link}}', link: 'X' })).toBe(
      '{{link}}'
    )
  })
})

describe('fillTemplate — escaping', () => {
  it('html context escapes substituted values by default', () => {
    expect(
      fillTemplate(
        '<p>{{name}}</p>',
        { name: '<script>x</script>' },
        {
          context: 'html',
          vocabulary: vocab
        }
      )
    ).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>')
  })

  it('html context inserts a rawHtml token verbatim', () => {
    expect(
      fillTemplate(
        '<a href="{{link}}">go</a>',
        { link: 'https://x/?a=1&b=2' },
        {
          context: 'html',
          vocabulary: vocab
        }
      )
    ).toBe('<a href="https://x/?a=1&b=2">go</a>')
  })

  // rawHtml is a property of the VOCABULARY (core code), never of the template text: with no
  // vocabulary nothing is raw, so a template author has no way to opt a value out of escaping.
  it('escapes a rawHtml-named token when the vocabulary does not declare it', () => {
    expect(
      fillTemplate('<p>{{link}}</p>', { link: '<b>x</b>' }, { context: 'html' })
    ).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>')
  })

  it('text context substitutes verbatim (no HTML context to break)', () => {
    expect(
      fillTemplate('{{name}}', { name: 'a & b <c>' }, { context: 'text' })
    ).toBe('a & b <c>')
  })

  it('a per-part value supplies html and text separately', () => {
    const values = { rows: { html: '<tr><td>a</td></tr>', text: 'a' } }
    expect(
      fillTemplate('<table>{{rows}}</table>', values, {
        context: 'html',
        vocabulary: vocab
      })
    ).toBe('<table><tr><td>a</td></tr></table>')
    expect(fillTemplate('{{rows}}', values, { context: 'text' })).toBe('a')
  })

  it('escapes the html half of a per-part value when the token is not rawHtml', () => {
    expect(
      fillTemplate(
        '{{name}}',
        { name: { html: '<b>', text: 'b' } },
        {
          context: 'html',
          vocabulary: vocab
        }
      )
    ).toBe('&lt;b&gt;')
  })
})

describe('fillTemplate — singleLine', () => {
  it('collapses whitespace runs and trims', () => {
    expect(
      fillTemplate(
        '  {{a}}   {{b}}  ',
        { a: 'x', b: 'y' },
        {
          singleLine: true
        }
      )
    ).toBe('x y')
  })

  // Header-injection floor: an email SUBJECT is a header, so CR/LF must never survive — not
  // from the template and not from a substituted value.
  it('removes CR/LF from the template and from substituted values', () => {
    expect(
      fillTemplate(
        'Re: {{a}}\r\nBcc: evil@x',
        { a: 'b\nc' },
        {
          singleLine: true
        }
      )
    ).toBe('Re: b c Bcc: evil@x')
  })

  it('is off by default so a text body keeps its line breaks', () => {
    expect(fillTemplate('a\n\nb {{t}}', { t: 'c' })).toBe('a\n\nb c')
  })
})

describe('tokenNamesIn / unknownTokensIn', () => {
  it('lists the tokens a template uses, de-duplicated and in order', () => {
    expect(tokenNamesIn('{{b}} {{a}} {{ b }}')).toEqual(['b', 'a'])
  })

  it('reports only the tokens outside the vocabulary, de-duplicated', () => {
    expect(unknownTokensIn('{{name}} {{oops}} {{oops}}', vocab)).toEqual([
      'oops'
    ])
  })

  it('reports nothing for a template with no tokens', () => {
    expect(unknownTokensIn('plain text', vocab)).toEqual([])
  })
})

describe('htmlToPlainText', () => {
  it('drops tags, keeps block structure, and decodes entities', () => {
    expect(
      htmlToPlainText('<h2>Hi &amp; bye</h2><p>one</p><p>two<br>three</p>')
    ).toBe('Hi & bye\n\none\n\ntwo\nthree')
  })

  it('renders a link as its text followed by the URL', () => {
    expect(htmlToPlainText('<p><a href="https://x/y">Click</a></p>')).toBe(
      'Click (https://x/y)'
    )
  })

  it('drops script and style content entirely', () => {
    expect(
      htmlToPlainText(
        '<style>p{color:red}</style><p>keep</p><script>x()</script>'
      )
    ).toBe('keep')
  })

  it('turns table rows into lines and cells into separated text', () => {
    expect(
      htmlToPlainText('<table><tr><td>name</td><td>Ada</td></tr></table>')
    ).toBe('name: Ada')
  })

  it('collapses runaway blank lines', () => {
    expect(htmlToPlainText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb')
  })
})
